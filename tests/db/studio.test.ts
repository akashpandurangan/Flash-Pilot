// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { createDb, type TestDb } from './harness'

/**
 * End-to-end checks of the database layer: RLS, role permissions, money maths,
 * the production state machine and the reminder pipeline. They run the real
 * migrations; roles are impersonated the same way PostgREST does.
 */

let t: TestDb
const ids = {} as Record<
  | 'owner' | 'photo1' | 'photo2' | 'editor' | 'manager' | 'managerFin' | 'studio' | 'client' | 'camera'
  | 'photo1Emp' | 'photo2Emp' | 'editorEmp' | 'managerEmp' | 'managerFinEmp' | 'ownerEmp'
  | 'otherOwner' | 'otherStudio',
  string
>

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString()

function payload(over: { events?: unknown[]; project?: Record<string, unknown>; finance?: unknown; initial_payment?: unknown } = {}) {
  return {
    project: {
      studio_id: ids.studio,
      client_id: ids.client,
      name: 'Sharma Wedding',
      event_type: 'wedding',
      booking_status: 'confirmed',
      ...over.project,
    },
    finance: over.finance === undefined ? { agreed_amount: 100000 } : over.finance,
    initial_payment: over.initial_payment === undefined ? { amount: 25000, method: 'upi', reference: 'UTR-1' } : over.initial_payment,
    events: over.events ?? [
      {
        title: 'Wedding ceremony',
        event_type: 'wedding',
        starts_at: hours(72),
        ends_at: hours(78),
        venue_name: 'Grand Hall',
        venue_address: '12 MG Road, Pune',
        assignments: [{ employee_id: ids.photo1Emp, role: 'lead_photographer' }],
        equipment: [{ equipment_id: ids.camera, quantity: 1 }],
      },
    ],
  }
}

async function saveProject(userId: string, p: unknown, projectId: string | null = null): Promise<string> {
  const res = await t.as(userId, () =>
    t.db.query<{ save_project: string }>(`select public.save_project($1, $2::jsonb)`, [projectId, JSON.stringify(p)]),
  )
  return res.rows[0]!.save_project
}

const q = <R = Record<string, unknown>>(userId: string, sql: string, params: unknown[] = []) =>
  t.as(userId, async () => (await t.db.query<R>(sql, params)).rows)

beforeAll(async () => {
  t = await createDb()

  ids.owner = await t.newUser('owner@studio.test', 'Olivia Owner')
  ids.photo1 = await t.newUser('p1@studio.test', 'Pia Photographer')
  ids.photo2 = await t.newUser('p2@studio.test', 'Paul Photographer')
  ids.editor = await t.newUser('ed@studio.test', 'Ed Editor')
  ids.manager = await t.newUser('mgr@studio.test', 'Mia Manager')
  ids.managerFin = await t.newUser('mgrfin@studio.test', 'Max Finance')
  ids.otherOwner = await t.newUser('other@studio.test', 'Other Owner')

  // Owner creates the studio through the RPC (onboarding step 1).
  ids.studio = (await q<{ create_studio: string }>(ids.owner, `select public.create_studio('Flash Studio','hello@flash.test','+91 98765 43210',null,'Pune','MH')`))[0]!.create_studio
  ids.otherStudio = (await q<{ create_studio: string }>(ids.otherOwner, `select public.create_studio('Rival Studio')`))[0]!.create_studio

  ids.ownerEmp = (await t.one<{ id: string }>(`select id from public.employees where user_id = $1`, [ids.owner])).id

  // Owner adds employee records (no accounts yet)...
  const addEmp = async (name: string, email: string, role: string) =>
    (await q<{ id: string }>(ids.owner, `insert into public.employees (studio_id, full_name, email, team_role) values ($1,$2,$3,$4) returning id`, [ids.studio, name, email, role]))[0]!.id
  ids.photo1Emp = await addEmp('Pia Photographer', 'p1@studio.test', 'photographer')
  ids.photo2Emp = await addEmp('Paul Photographer', 'p2@studio.test', 'photographer')
  ids.editorEmp = await addEmp('Ed Editor', 'ed@studio.test', 'editor')
  ids.managerEmp = await addEmp('Mia Manager', 'mgr@studio.test', 'studio_manager')
  ids.managerFinEmp = await addEmp('Max Finance', 'mgrfin@studio.test', 'studio_manager')

  // ...and the invite Edge Function (service role / privileged) links the accounts.
  const link = (emp: string, user: string, role: string, fin = false) =>
    t.db.query(`update public.employees set user_id=$2, access_role=$3, can_view_financials=$4, invite_status='accepted' where id=$1`, [emp, user, role, fin])
  await link(ids.photo1Emp, ids.photo1, 'photographer')
  await link(ids.photo2Emp, ids.photo2, 'photographer')
  await link(ids.editorEmp, ids.editor, 'editor')
  await link(ids.managerEmp, ids.manager, 'manager')
  await link(ids.managerFinEmp, ids.managerFin, 'manager', true)

  ids.client = (await q<{ id: string }>(ids.owner, `insert into public.clients (studio_id, full_name, phone, email, notes) values ($1,'Anita Sharma','+91 99999 11111','anita@example.com','VIP - internal note') returning id`, [ids.studio]))[0]!.id
  ids.camera = (await q<{ id: string }>(ids.owner, `insert into public.equipment (studio_id, name, category, asset_tag, quantity_owned) values ($1,'Sony A7IV','still_camera','CAM-001',1) returning id`, [ids.studio]))[0]!.id
})

describe('onboarding & accounts', () => {
  it('creates a profile for every new auth user', async () => {
    const p = await t.one<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [ids.owner])
    expect(p.full_name).toBe('Olivia Owner')
  })

  it('create_studio makes the caller the owner with financial access and saves the onboarding step', async () => {
    const e = await t.one<{ access_role: string; can_view_financials: boolean; invite_status: string }>(
      `select access_role, can_view_financials, invite_status from public.employees where id = $1`, [ids.ownerEmp])
    expect(e).toEqual({ access_role: 'owner', can_view_financials: true, invite_status: 'accepted' })
    expect((await t.one<{ onboarding_step: number }>(`select onboarding_step from public.studios where id=$1`, [ids.studio])).onboarding_step).toBe(2)
  })

  it('refuses a second studio for the same owner', async () => {
    const msg = await t.as(ids.owner, () => t.fails(`select public.create_studio('Another')`))
    expect(msg).toMatch(/studio_exists/)
  })

  it('persists onboarding progress and completion; only the owner may do so', async () => {
    await q(ids.owner, `select public.save_onboarding_step($1, 3::smallint)`, [ids.studio])
    expect((await t.one<{ onboarding_step: number }>(`select onboarding_step from public.studios where id=$1`, [ids.studio])).onboarding_step).toBe(3)
    expect(await t.as(ids.manager, () => t.fails(`select public.complete_onboarding($1)`, [ids.studio]))).toMatch(/forbidden/)
    await q(ids.owner, `select public.complete_onboarding($1)`, [ids.studio])
    const s = await t.one<{ onboarding_completed_at: string | null }>(`select onboarding_completed_at from public.studios where id=$1`, [ids.studio])
    expect(s.onboarding_completed_at).not.toBeNull()
  })

  it('rejects invalid time zones', async () => {
    const msg = await t.as(ids.owner, () => t.fails(`update public.studios set timezone='Mars/Phobos' where id=$1`, [ids.studio]))
    expect(msg).toMatch(/invalid_timezone/)
  })
})

describe('tenant isolation & anonymous access', () => {
  it('anonymous visitors can read nothing', async () => {
    const msg = await t.asAnon(() => t.fails(`select * from public.clients`))
    expect(msg).toMatch(/permission denied/)
  })

  it("another studio's owner cannot see or touch this studio's data", async () => {
    expect(await q(ids.otherOwner, `select id from public.clients`)).toHaveLength(0)
    expect(await q(ids.otherOwner, `select id from public.employees where studio_id = $1`, [ids.studio])).toHaveLength(0)
    const upd = await t.as(ids.otherOwner, () => t.db.query(`update public.studios set name='Hacked' where id=$1`, [ids.studio]))
    expect(upd.affectedRows).toBe(0)
  })

  it("cannot attach another studio's client to a project (composite foreign key + RPC check)", async () => {
    const foreign = (await q<{ id: string }>(ids.otherOwner, `insert into public.clients (studio_id, full_name, phone) values ($1,'Rival Client','123') returning id`, [ids.otherStudio]))[0]!.id
    const msg = await t.as(ids.owner, () =>
      t.fails(`select public.save_project(null, $1::jsonb)`, [JSON.stringify(payload({ project: { client_id: foreign } }))]))
    expect(msg).toMatch(/invalid_client/)
  })
})

describe('employee guard', () => {
  it('lets a manager edit descriptive fields but never access settings', async () => {
    await q(ids.manager, `update public.employees set phone='+91 90000 00000' where id=$1`, [ids.photo1Emp])
    const msg = await t.as(ids.manager, () => t.fails(`update public.employees set access_role='manager' where id=$1`, [ids.photo1Emp]))
    expect(msg).toMatch(/only the studio owner/)
    const msg2 = await t.as(ids.manager, () => t.fails(`update public.employees set can_view_financials=true where id=$1`, [ids.managerEmp]))
    expect(msg2).toMatch(/only the studio owner/)
  })

  it('does not let a manager create an employee with an account or link an arbitrary user', async () => {
    const msg = await t.as(ids.manager, () =>
      t.fails(`insert into public.employees (studio_id, full_name, user_id, access_role) values ($1,'Sneaky',$2,'manager')`, [ids.studio, ids.otherOwner]))
    expect(msg).toMatch(/invitation/)
  })

  it('protects the owner row from demotion or deactivation', async () => {
    const msg = await t.as(ids.owner, () => t.fails(`update public.employees set is_active=false where id=$1`, [ids.ownerEmp]))
    expect(msg).toMatch(/owner_protected/)
  })

  it('crew cannot modify the team', async () => {
    const res = await t.as(ids.photo1, () => t.db.query(`update public.employees set phone='x' where id=$1`, [ids.photo2Emp]))
    expect(res.affectedRows).toBe(0)
  })
})

describe('project creation, money and checklist', () => {
  let project: string

  beforeAll(async () => {
    project = await saveProject(ids.owner, payload())
  })

  it('creates the project, event, team, equipment, finance and a unique project id in one call', async () => {
    const p = await t.one<{ project_code: string; booking_status: string; production_stage: string }>(`select * from public.projects where id=$1`, [project])
    expect(p.project_code).toBe('FP-0001')
    expect(p.booking_status).toBe('confirmed')
    expect(p.production_stage).toBe('upcoming')
    expect(await t.rows(`select 1 from public.event_assignments a join public.project_events e on e.id=a.event_id where e.project_id=$1`, [project])).toHaveLength(1)
    expect(await t.rows(`select 1 from public.event_equipment ee join public.project_events e on e.id=ee.event_id where e.project_id=$1`, [project])).toHaveLength(1)
    const second = await saveProject(ids.owner, payload({ project: { name: 'Second' }, initial_payment: null }))
    expect((await t.one<{ project_code: string }>(`select project_code from public.projects where id=$1`, [second])).project_code).toBe('FP-0002')
  })

  it('seeds the default production checklist', async () => {
    const tasks = await t.rows<{ title: string; phase: string }>(`select title, phase from public.production_tasks where project_id=$1 order by sort_order`, [project])
    expect(tasks).toHaveLength(10)
    expect(tasks[0]).toEqual({ title: 'Team confirmed', phase: 'preparation' })
    expect(tasks.at(-1)).toEqual({ title: 'Delivery completed', phase: 'delivery' })
  })

  it('derives the balance from recorded payments (advance 25,000 of 1,00,000)', async () => {
    const f = await t.one<{ agreed_amount: string; paid_amount: string; balance: string }>(`select * from public.project_financials where project_id=$1`, [project])
    expect([Number(f.agreed_amount), Number(f.paid_amount), Number(f.balance)]).toEqual([100000, 25000, 75000])
    const pay = await t.one<{ is_advance: boolean; recorded_by_name: string }>(`select is_advance, recorded_by_name from public.payments where project_id=$1`, [project])
    expect(pay).toEqual({ is_advance: true, recorded_by_name: 'Olivia Owner' })
  })

  it('records a second payment and recalculates; voiding restores the balance', async () => {
    const id = (await q<{ record_payment: string }>(ids.owner, `select public.record_payment($1, 30000, current_date, 'cash')`, [project]))[0]!.record_payment
    expect(Number((await t.one<{ balance: string }>(`select balance from public.project_financials where project_id=$1`, [project])).balance)).toBe(45000)
    await q(ids.owner, `select public.void_payment($1, 'entered twice')`, [id])
    expect(Number((await t.one<{ balance: string }>(`select balance from public.project_financials where project_id=$1`, [project])).balance)).toBe(75000)
    // voiding twice is a no-op, and the voided row is retained for history
    await q(ids.owner, `select public.void_payment($1)`, [id])
    expect((await t.one<{ status: string }>(`select status from public.payments where id=$1`, [id])).status).toBe('void')
  })

  it('blocks accidental overpayment but records an explicit one as credit', async () => {
    const msg = await t.as(ids.owner, () => t.fails(`select public.record_payment($1, 80000, current_date, 'upi')`, [project]))
    expect(msg).toMatch(/overpayment/)
    await q(ids.owner, `select public.record_payment($1, 80000, current_date, 'upi', 'UTR-2', null, false, true)`, [project])
    const f = await t.one<{ balance: string }>(`select balance from public.project_financials where project_id=$1`, [project])
    expect(Number(f.balance)).toBe(-5000) // credit of 5,000
  })

  it('rejects invalid amounts', async () => {
    for (const bad of ['0', '-5', '10.999']) {
      const msg = await t.as(ids.owner, () => t.fails(`select public.record_payment($1, ${bad}, current_date, 'cash')`, [project]))
      expect(msg).toMatch(/invalid_amount/)
    }
  })

  it('rejects a missing event list and bad event times', async () => {
    expect(await t.as(ids.owner, () => t.fails(`select public.save_project(null,$1::jsonb)`, [JSON.stringify(payload({ events: [] }))]))).toMatch(/events_required/)
    const bad = payload({ events: [{ title: 'X', starts_at: hours(10), ends_at: hours(9) }] })
    expect(await t.as(ids.owner, () => t.fails(`select public.save_project(null,$1::jsonb)`, [JSON.stringify(bad)]))).toMatch(/check/)
  })

  it('records the activity trail with financial entries marked', async () => {
    const logs = await t.rows<{ action: string; category: string }>(`select action, category from public.activity_logs where project_id=$1`, [project])
    const actions = logs.map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['project_created', 'team_assigned', 'advance_recorded', 'payment_recorded']))
    expect(logs.find((l) => l.action === 'advance_recorded')?.category).toBe('financial')
  })
})

describe('role-based access (RLS)', () => {
  let project: string

  beforeAll(async () => {
    project = await saveProject(ids.owner, payload({ project: { name: 'Access Test' }, initial_payment: { amount: 1000, method: 'cash' } }))
  })

  it('assigned photographer sees only their project, with client name and phone but not the client record', async () => {
    const overview = await q<{ name: string; client_name: string; client_phone: string | null; client_email: string | null }>(
      ids.photo1, `select name, client_name, client_phone, client_email from public.project_overview where id = $1`, [project])
    expect(overview).toHaveLength(1)
    expect(overview[0]!.client_name).toBe('Anita Sharma')
    expect(overview[0]!.client_phone).toBe('+91 99999 11111')
    expect(overview[0]!.client_email).toBeNull()
    expect(await q(ids.photo1, `select * from public.clients`)).toHaveLength(0)
  })

  it('photographer cannot read finance, payments or the financial view', async () => {
    expect(await q(ids.photo1, `select * from public.project_finance`)).toHaveLength(0)
    expect(await q(ids.photo1, `select * from public.payments`)).toHaveLength(0)
    expect(await q(ids.photo1, `select * from public.project_financials`)).toHaveLength(0)
    expect(await t.as(ids.photo1, () => t.fails(`select public.record_payment($1, 10)`, [project]))).toMatch(/forbidden/)
  })

  it('photographer does not see financial activity entries', async () => {
    const logs = await q<{ category: string }>(ids.photo1, `select category from public.activity_logs where project_id=$1`, [project])
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.every((l) => l.category !== 'financial')).toBe(true)
  })

  it('an unassigned photographer sees nothing about the project', async () => {
    expect(await q(ids.photo2, `select * from public.projects where id=$1`, [project])).toHaveLength(0)
    expect(await q(ids.photo2, `select * from public.project_overview`)).toHaveLength(0)
    expect(await q(ids.photo2, `select * from public.project_events`)).toHaveLength(0)
    expect(await q(ids.photo2, `select * from public.activity_logs`)).toHaveLength(0)
  })

  it('crew cannot write projects, events or assignments directly', async () => {
    const r1 = await t.as(ids.photo1, () => t.db.query(`update public.projects set name='x' where id=$1`, [project]))
    expect(r1.affectedRows).toBe(0)
    const msg = await t.as(ids.photo1, () => t.fails(`insert into public.event_assignments (studio_id,event_id,employee_id) select studio_id,id,$2 from public.project_events where project_id=$1`, [project, ids.photo1Emp]))
    expect(msg).toMatch(/row-level security/)
    expect(await t.as(ids.photo1, () => t.fails(`select public.save_project($1, $2::jsonb)`, [project, JSON.stringify(payload())]))).toMatch(/forbidden/)
  })

  it('editor is excluded from payments and from unrelated projects until named as editor', async () => {
    expect(await q(ids.editor, `select * from public.payments`)).toHaveLength(0)
    expect(await q(ids.editor, `select * from public.project_overview where id=$1`, [project])).toHaveLength(0)
    await q(ids.owner, `update public.projects set editor_id=$2 where id=$1`, [project, ids.editorEmp])
    expect(await q(ids.editor, `select * from public.project_overview where id=$1`, [project])).toHaveLength(1)
    const o = await q<{ client_phone: string | null }>(ids.editor, `select client_phone from public.project_overview where id=$1`, [project])
    expect(o[0]!.client_phone).toBeNull()
  })

  it('manager without the financial flag runs bookings but cannot see or set money', async () => {
    const created = await saveProject(ids.manager, payload({ project: { name: 'Manager Booking' }, finance: { agreed_amount: 999999 }, initial_payment: { amount: 5000, method: 'cash' } }))
    expect(await q(ids.manager, `select * from public.project_finance`)).toHaveLength(0)
    const f = await t.one<{ agreed_amount: string }>(`select agreed_amount from public.project_finance where project_id=$1`, [created])
    expect(Number(f.agreed_amount)).toBe(0) // submitted amount was ignored
    expect(await t.rows(`select 1 from public.payments where project_id=$1`, [created])).toHaveLength(0)
    expect(await t.as(ids.manager, () => t.fails(`select public.record_payment($1, 100)`, [created]))).toMatch(/forbidden/)
  })

  it('manager with the financial flag can see and record payments', async () => {
    expect((await q(ids.managerFin, `select * from public.project_finance where project_id=$1`, [project])).length).toBe(1)
    await q(ids.managerFin, `select public.record_payment($1, 500, current_date, 'cash')`, [project])
  })

  it('notifications are private to their recipient (and visible to the owner as administrator)', async () => {
    const mine = await q<{ recipient_employee_id: string }>(ids.photo1, `select recipient_employee_id from public.notifications`)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((n) => n.recipient_employee_id === ids.photo1Emp)).toBe(true)
    expect(await q(ids.photo2, `select * from public.notifications`)).toHaveLength(0)
    expect((await q(ids.owner, `select * from public.notifications`)).length).toBeGreaterThanOrEqual(mine.length)
  })

  it('notification state can only be changed through the RPC', async () => {
    expect(await t.as(ids.photo1, () => t.fails(`update public.notifications set read_at=now()`))).toMatch(/permission denied/)
    const list = await q<{ id: string }>(ids.photo1, `select id from public.notifications where read_at is null`)
    await q(ids.photo1, `select public.mark_notifications_read($1::uuid[])`, [list.map((n) => n.id)])
    expect(await q(ids.photo1, `select id from public.notifications where read_at is null`)).toHaveLength(0)
    // someone else's notification can't be marked
    await q(ids.photo2, `select public.mark_notifications_read($1::uuid[])`, [list.map((n) => n.id)])
  })

  it('dashboard KPIs hide money from users without financial access and scope crew to their work', async () => {
    const owner = (await q<{ dashboard_kpis: Record<string, unknown> }>(ids.owner, `select public.dashboard_kpis($1)`, [ids.studio]))[0]!.dashboard_kpis
    expect(Number(owner.outstanding_amount)).toBeGreaterThan(0)
    expect(Number(owner.upcoming_events)).toBeGreaterThanOrEqual(3)
    const crew = (await q<{ dashboard_kpis: Record<string, unknown> }>(ids.photo2, `select public.dashboard_kpis($1)`, [ids.studio]))[0]!.dashboard_kpis
    expect(crew.outstanding_amount).toBeNull()
    expect(Number(crew.upcoming_events)).toBe(0)
  })
})

describe('production workflow state machine', () => {
  let project: string
  const act = (user: string, action: string, id = project) =>
    q<{ production_stage: string; booking_status: string }>(user, `select production_stage, booking_status from public.project_workflow_action($1,$2)`, [id, action])
  const failAct = (user: string, action: string, id = project) =>
    t.as(user, () => t.fails(`select public.project_workflow_action($1,$2)`, [id, action]))

  beforeAll(async () => {
    project = await saveProject(ids.owner, payload({ project: { name: 'Workflow Test', editor_id: ids.editorEmp }, initial_payment: null }))
  })

  it('walks upcoming -> production -> editing -> ready -> delivered with the right people', async () => {
    expect(await failAct(ids.photo2, 'start_production')).toMatch(/forbidden/) // not on this project
    expect((await act(ids.photo1, 'start_production'))[0]!.production_stage).toBe('production')

    expect(await failAct(ids.owner, 'start_editing')).toMatch(/complete the shoot/)
    await act(ids.photo1, 'complete_shoot')
    expect(await failAct(ids.photo1, 'start_editing')).toMatch(/forbidden/) // photographers hand over, they do not start editing
    expect((await act(ids.owner, 'start_editing'))[0]!.production_stage).toBe('editing')

    expect(await failAct(ids.editor, 'mark_ready')).toMatch(/finish editing first/)
    await act(ids.editor, 'complete_editing')
    expect((await act(ids.editor, 'mark_ready'))[0]!.production_stage).toBe('ready_for_delivery')

    expect(await failAct(ids.editor, 'mark_delivered')).toMatch(/forbidden/)
    expect(await failAct(ids.owner, 'mark_delivered')).toMatch(/delivery_details_required/)
    await q(ids.owner, `insert into public.project_deliveries (project_id, studio_id, method, delivered_on, link_url) values ($1,$2,'online_gallery',current_date,'https://gallery.test/abc')`, [project, ids.studio])
    expect((await act(ids.owner, 'mark_delivered'))[0]!.production_stage).toBe('delivered')

    const d = await t.one<{ confirmed_at: string | null }>(`select confirmed_at from public.project_deliveries where project_id=$1`, [project])
    expect(d.confirmed_at).not.toBeNull()
  })

  it('persists delivery details and allows delivery with an outstanding balance', async () => {
    const d = await t.one<{ link_url: string }>(`select link_url from public.project_deliveries where project_id=$1`, [project])
    expect(d.link_url).toBe('https://gallery.test/abc')
    const f = await t.one<{ balance: string }>(`select balance from public.project_financials where project_id=$1`, [project])
    expect(Number(f.balance)).toBe(100000)
  })

  it('records who did what and when', async () => {
    const logs = await t.rows<{ action: string; actor_name: string }>(`select action, actor_name from public.activity_logs where project_id=$1 and action like 'workflow_%' order by created_at, action`, [project])
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['workflow_start_production', 'workflow_complete_shoot', 'workflow_complete_editing', 'workflow_mark_delivered']))
    expect(logs.find((l) => l.action === 'workflow_complete_editing')?.actor_name).toBe('Ed Editor')
  })

  it('owner can step back one stage with milestones cleared', async () => {
    const r = await act(ids.owner, 'revert')
    expect(r[0]!.production_stage).toBe('ready_for_delivery')
    expect(await failAct(ids.editor, 'revert')).toMatch(/forbidden/)
    const row = await t.one<{ delivered_at: string | null }>(`select delivered_at from public.projects where id=$1`, [project])
    expect(row.delivered_at).toBeNull()
  })

  it('does not allow production changes on an inquiry or a cancelled booking', async () => {
    const inquiry = await saveProject(ids.owner, payload({ project: { name: 'Just an inquiry', booking_status: 'inquiry' }, initial_payment: null }))
    expect(await failAct(ids.owner, 'start_production', inquiry)).toMatch(/booking_not_confirmed/)
    const cancelled = await saveProject(ids.owner, payload({ project: { name: 'To cancel' }, initial_payment: null }))
    await q(ids.owner, `select public.set_booking_status($1,'cancelled','client withdrew')`, [cancelled])
    expect(await failAct(ids.owner, 'start_production', cancelled)).toMatch(/booking_not_confirmed/)
  })

  it('ticking checklist items is limited by phase and never completes the project', async () => {
    const tasks = await q<{ id: string; phase: string }>(ids.owner, `select id, phase from public.production_tasks where project_id=$1`, [project])
    const shoot = tasks.find((x) => x.phase === 'shoot')!
    const editing = tasks.find((x) => x.phase === 'editing')!
    const delivery = tasks.find((x) => x.phase === 'delivery')!
    await q(ids.photo1, `select public.set_task_done($1, true)`, [shoot.id])
    expect(await t.as(ids.photo1, () => t.fails(`select public.set_task_done($1, true)`, [editing.id]))).toMatch(/forbidden/)
    await q(ids.editor, `select public.set_task_done($1, true)`, [editing.id])
    expect(await t.as(ids.editor, () => t.fails(`select public.set_task_done($1, true)`, [delivery.id]))).toMatch(/forbidden/)
    const done = await t.one<{ done_by_name: string; is_done: boolean }>(`select done_by_name, is_done from public.production_tasks where id=$1`, [editing.id])
    expect(done).toEqual({ is_done: true, done_by_name: 'Ed Editor' })
    const p = await t.one<{ production_stage: string }>(`select production_stage from public.projects where id=$1`, [project])
    expect(p.production_stage).toBe('ready_for_delivery') // unchanged by task completion
  })
})

describe('booking lifecycle', () => {
  it('only allows sensible transitions', async () => {
    const p = await saveProject(ids.owner, payload({ project: { name: 'Lifecycle', booking_status: 'inquiry' }, initial_payment: null }))
    await q(ids.owner, `select public.set_booking_status($1,'confirmed')`, [p])
    await q(ids.owner, `select public.set_booking_status($1,'cancelled','changed mind')`, [p])
    const row = await t.one<{ cancel_reason: string; cancelled_at: string | null }>(`select cancel_reason, cancelled_at from public.projects where id=$1`, [p])
    expect(row.cancel_reason).toBe('changed mind')
    expect(row.cancelled_at).not.toBeNull()
    expect(await t.as(ids.owner, () => t.fails(`select public.set_booking_status($1,'confirmed')`, [p]))).toMatch(/invalid_transition/)
    await q(ids.owner, `select public.set_booking_status($1,'inquiry')`, [p]) // re-open
  })

  it('crew cannot confirm or cancel bookings', async () => {
    const p = await saveProject(ids.owner, payload({ project: { name: 'Crew cannot', booking_status: 'inquiry' }, initial_payment: null }))
    expect(await t.as(ids.photo1, () => t.fails(`select public.set_booking_status($1,'confirmed')`, [p]))).toMatch(/forbidden/)
  })
})

describe('reminders & notifications', () => {
  const remindersFor = (eventId: string) =>
    t.rows<{ status: string; event_starts_at: string }>(`select status, event_starts_at from public.event_reminders where event_id=$1 order by created_at, status`, [eventId])

  async function projectWithEventIn(hoursAhead: number, bookingStatus = 'confirmed', name = 'Reminder Test') {
    const project = await saveProject(ids.owner, payload({
      project: { name, booking_status: bookingStatus },
      initial_payment: null,
      events: [{
        title: 'Haldi', starts_at: hours(hoursAhead), ends_at: hours(hoursAhead + 4), venue_name: 'Farmhouse',
        venue_address: 'Plot 4, Baner', notes: 'Bring reflectors',
        assignments: [{ employee_id: ids.photo1Emp, role: 'lead_photographer' }, { employee_id: ids.editorEmp, role: 'editor' }],
      }],
    }))
    const event = (await t.one<{ id: string }>(`select id from public.project_events where project_id=$1`, [project])).id
    return { project, event }
  }

  it('inquiries do not create reminders; confirming one does, once per assignee', async () => {
    const { project, event } = await projectWithEventIn(48, 'inquiry', 'Inquiry reminder')
    expect(await remindersFor(event)).toHaveLength(0)
    expect(await t.rows(`select 1 from public.notifications where project_id=$1`, [project])).toHaveLength(0)
    await q(ids.owner, `select public.set_booking_status($1,'confirmed')`, [project])
    const r = await remindersFor(event)
    expect(r).toHaveLength(2)
    expect(r.every((x) => x.status === 'scheduled')).toBe(true)
    // confirming also announces the assignment to each person, exactly once
    const n = await t.rows<{ type: string }>(`select type from public.notifications where project_id=$1`, [project])
    expect(n.filter((x) => x.type === 'new_assignment')).toHaveLength(2)
  })

  it('schedules the reminder 24h before the reporting time and does not fire early', async () => {
    const { event } = await projectWithEventIn(72)
    const r = await t.one<{ remind_at: string; event_starts_at: string }>(`select remind_at, event_starts_at from public.event_reminders where event_id=$1 and employee_id=$2`, [event, ids.photo1Emp])
    const lead = (new Date(r.event_starts_at).getTime() - new Date(r.remind_at).getTime()) / 3_600_000
    expect(Math.round(lead)).toBe(24)
    await t.db.query(`select public.process_due_notifications()`)
    expect(await t.rows(`select 1 from public.notifications where event_id=$1 and type='event_reminder'`, [event])).toHaveLength(0)
  })

  it('delivers a due reminder exactly once, no matter how often the job runs', async () => {
    const { event } = await projectWithEventIn(10, 'confirmed', 'Due soon')
    const first = (await t.one<{ process_due_notifications: Record<string, number> }>(`select public.process_due_notifications()`)).process_due_notifications
    expect(first.reminders_sent).toBeGreaterThanOrEqual(2)
    await t.db.query(`select public.process_due_notifications()`)
    await t.db.query(`select public.process_due_notifications()`)
    const notes = await t.rows<{ title: string; body: string; recipient_employee_id: string; show_in_app: boolean }>(
      `select title, body, recipient_employee_id, show_in_app from public.notifications where event_id=$1 and type='event_reminder'`, [event])
    expect(notes).toHaveLength(2)
    const photographer = notes.find((n) => n.recipient_employee_id === ids.photo1Emp)!
    expect(photographer.body).toContain('Farmhouse, Plot 4, Baner')
    expect(photographer.body).toContain('Lead Photographer')
    expect(photographer.body).toContain('Anita Sharma (+91 99999 11111)')
    expect(photographer.body).toContain('Bring reflectors')
    // editors never get the client's phone number
    const editor = notes.find((n) => n.recipient_employee_id === ids.editorEmp)!
    expect(editor.body).toContain('Anita Sharma')
    expect(editor.body).not.toContain('+91 99999')
    expect((await remindersFor(event)).every((r) => r.status === 'sent')).toBe(true)
  })

  it('rescheduling supersedes the old reminder and schedules a new one at the new time', async () => {
    const { event } = await projectWithEventIn(96, 'confirmed', 'Reschedule me')
    await q(ids.owner, `update public.project_events set starts_at=$2, ends_at=$3 where id=$1`, [event, hours(120), hours(124)])
    const r = await remindersFor(event)
    expect(r.filter((x) => x.status === 'superseded')).toHaveLength(2)
    expect(r.filter((x) => x.status === 'scheduled')).toHaveLength(2)
    const notices = await t.rows<{ type: string }>(`select type from public.notifications where event_id=$1`, [event])
    expect(notices.filter((n) => n.type === 'event_rescheduled')).toHaveLength(2)
  })

  it('a reminder that was already due but not yet sent is never delivered after a reschedule', async () => {
    const { event } = await projectWithEventIn(12, 'confirmed', 'Race')
    // reminder is due now; reschedule before the job runs
    await q(ids.owner, `update public.project_events set starts_at=$2, ends_at=$3 where id=$1`, [event, hours(200), hours(204)])
    await t.db.query(`select public.process_due_notifications()`)
    expect(await t.rows(`select 1 from public.notifications where event_id=$1 and type='event_reminder'`, [event])).toHaveLength(0)
  })

  it('cancelling the booking cancels reminders, notifies the team and sends no stale reminder', async () => {
    const { project, event } = await projectWithEventIn(11, 'confirmed', 'Cancel me')
    await q(ids.owner, `select public.set_booking_status($1,'cancelled','venue closed')`, [project])
    expect((await remindersFor(event)).every((r) => r.status === 'cancelled')).toBe(true)
    await t.db.query(`select public.process_due_notifications()`)
    const types = (await t.rows<{ type: string }>(`select type from public.notifications where event_id=$1`, [event])).map((n) => n.type)
    expect(types).not.toContain('event_reminder')
    expect(types.filter((x) => x === 'event_cancelled')).toHaveLength(2)
  })

  it('cancelling a single event and removing a person both withdraw their reminder', async () => {
    const { event } = await projectWithEventIn(100, 'confirmed', 'Partial')
    await q(ids.owner, `delete from public.event_assignments where event_id=$1 and employee_id=$2`, [event, ids.editorEmp])
    const after = await t.rows<{ employee_id: string; status: string }>(`select employee_id, status from public.event_reminders where event_id=$1`, [event])
    expect(after.find((r) => r.employee_id === ids.editorEmp)?.status).toBe('cancelled')
    expect(after.find((r) => r.employee_id === ids.photo1Emp)?.status).toBe('scheduled')
    await q(ids.owner, `update public.project_events set cancelled_at=now() where id=$1`, [event])
    expect((await remindersFor(event)).every((r) => r.status === 'cancelled')).toBe(true)
  })

  it('deactivated employees keep history, lose pending reminders and cannot be newly assigned', async () => {
    const { project, event } = await projectWithEventIn(150, 'confirmed', 'Deactivate')
    await q(ids.owner, `update public.employees set is_active=false where id=$1`, [ids.photo2Emp])
    await q(ids.owner, `update public.employees set is_active=false where id=$1`, [ids.editorEmp])
    const r = await t.rows<{ employee_id: string; status: string }>(`select employee_id, status from public.event_reminders where event_id=$1`, [event])
    expect(r.find((x) => x.employee_id === ids.editorEmp)?.status).toBe('cancelled')
    // the historical assignment is still there
    expect(await t.rows(`select 1 from public.event_assignments where event_id=$1 and employee_id=$2`, [event, ids.editorEmp])).toHaveLength(1)
    expect(await t.as(ids.owner, () => t.fails(`insert into public.event_assignments (studio_id,event_id,employee_id) values ($1,$2,$3)`, [ids.studio, event, ids.photo2Emp]))).toMatch(/employee_inactive/)
    // a deactivated user loses access immediately
    expect(await q(ids.editor, `select * from public.project_overview where id=$1`, [project])).toHaveLength(0)
    await q(ids.owner, `update public.employees set is_active=true where id=$1`, [ids.photo2Emp])
    await q(ids.owner, `update public.employees set is_active=true where id=$1`, [ids.editorEmp])
  })

  it('honours notification preferences', async () => {
    await q(ids.photo1, `insert into public.notification_preferences (user_id, studio_id, cat_reminders, email_enabled) values ($1,$2,false,false) on conflict (user_id, studio_id) do update set cat_reminders=false, email_enabled=false`, [ids.photo1, ids.studio])
    const { event } = await projectWithEventIn(9, 'confirmed', 'Prefs')
    await t.db.query(`select public.process_due_notifications()`)
    const forPhotographer = await t.rows(`select 1 from public.notifications where event_id=$1 and recipient_employee_id=$2 and type='event_reminder'`, [event, ids.photo1Emp])
    expect(forPhotographer).toHaveLength(0)
    expect((await remindersFor(event)).find((r) => r.status === 'skipped')).toBeDefined()
    await q(ids.photo1, `delete from public.notification_preferences where user_id=$1`, [ids.photo1])
  })

  it('a person cannot edit someone else\'s preferences', async () => {
    const msg = await t.as(ids.photo1, () => t.fails(`insert into public.notification_preferences (user_id, studio_id) values ($1,$2)`, [ids.photo2, ids.studio]))
    expect(msg).toMatch(/row-level security/)
  })
})

describe('e-mail delivery queue', () => {
  let deliveryId: string

  it('queues one e-mail per notification for people with an address', async () => {
    const d = await t.rows<{ id: string; status: string; to_address: string }>(`select id, status, to_address from public.notification_deliveries order by created_at limit 1`)
    expect(d[0]!.status).toBe('pending')
    deliveryId = d[0]!.id
    const dup = await t.rows(`select notification_id from public.notification_deliveries group by notification_id, channel having count(*) > 1`)
    expect(dup).toHaveLength(0)
  })

  it('claims work with a lease so two workers never take the same row', async () => {
    const first = await t.rows<{ delivery_id: string }>(`select * from public.claim_pending_deliveries(1)`)
    expect(first).toHaveLength(1)
    const second = await t.rows<{ delivery_id: string }>(`select * from public.claim_pending_deliveries(1000)`)
    expect(second.map((r) => r.delivery_id)).not.toContain(first[0]!.delivery_id)
    deliveryId = first[0]!.delivery_id
  })

  it('retries temporary failures with back-off and logs every attempt', async () => {
    await t.db.query(`select public.record_delivery_result($1,'retry','smtp timeout')`, [deliveryId])
    const d = await t.one<{ status: string; last_error: string; next_attempt_at: string }>(`select status, last_error, next_attempt_at from public.notification_deliveries where id=$1`, [deliveryId])
    expect(d.status).toBe('pending')
    expect(d.last_error).toBe('smtp timeout')
    expect(new Date(d.next_attempt_at).getTime()).toBeGreaterThan(Date.now())
    const attempts = await t.rows<{ success: boolean; error: string }>(`select success, error from public.notification_delivery_attempts where delivery_id=$1`, [deliveryId])
    expect(attempts).toEqual([{ success: false, error: 'smtp timeout' }])
  })

  it('marks a delivery failed once attempts are exhausted, and settled rows are never reopened', async () => {
    await t.db.query(`update public.notification_deliveries set status='processing', attempts=max_attempts where id=$1`, [deliveryId])
    await t.db.query(`select public.record_delivery_result($1,'retry','still down')`, [deliveryId])
    expect((await t.one<{ status: string }>(`select status from public.notification_deliveries where id=$1`, [deliveryId])).status).toBe('failed')
    await t.db.query(`select public.record_delivery_result($1,'sent',null,'msg_1')`, [deliveryId])
    expect((await t.one<{ status: string }>(`select status from public.notification_deliveries where id=$1`, [deliveryId])).status).toBe('failed')
  })

  it('records a successful send once and marks "skipped" honestly when no provider is configured', async () => {
    // release the rows leased by the previous test so there is fresh work to claim
    await t.db.query(`update public.notification_deliveries set status='pending', locked_at=null, next_attempt_at=now() where status in ('processing','pending')`)
    const [a, b] = await t.rows<{ delivery_id: string }>(`select * from public.claim_pending_deliveries(2)`)
    await t.db.query(`select public.record_delivery_result($1,'sent',null,'msg_42','{"id":"msg_42"}'::jsonb)`, [a!.delivery_id])
    await t.db.query(`select public.record_delivery_result($1,'sent',null,'msg_42')`, [a!.delivery_id]) // idempotent
    expect(await t.rows(`select 1 from public.notification_delivery_attempts where delivery_id=$1`, [a!.delivery_id])).toHaveLength(1)
    const sent = await t.one<{ status: string; provider_message_id: string }>(`select status, provider_message_id from public.notification_deliveries where id=$1`, [a!.delivery_id])
    expect(sent).toEqual({ status: 'sent', provider_message_id: 'msg_42' })
    await t.db.query(`select public.record_delivery_result($1,'skipped','Email provider not configured')`, [b!.delivery_id])
    expect((await t.one<{ status: string }>(`select status from public.notification_deliveries where id=$1`, [b!.delivery_id])).status).toBe('skipped')
  })

  it('end users cannot invoke the job functions', async () => {
    expect(await t.as(ids.owner, () => t.fails(`select public.process_due_notifications()`))).toMatch(/permission denied/)
    expect(await t.as(ids.owner, () => t.fails(`select * from public.claim_pending_deliveries()`))).toMatch(/permission denied/)
  })
})

describe('deadline notices', () => {
  it('warns about overdue editing/delivery and payments exactly once per day', async () => {
    const project = await saveProject(ids.owner, payload({
      project: { name: 'Overdue', editor_id: ids.editorEmp, editing_due_date: '2020-01-01', delivery_due_date: '2020-01-05' },
      finance: { agreed_amount: 5000, payment_due_date: '2020-01-01' },
      initial_payment: null,
    }))
    await t.db.query(`select public.process_due_notifications()`)
    await t.db.query(`select public.process_due_notifications()`)
    const types = (await t.rows<{ type: string; recipient_employee_id: string }>(`select type, recipient_employee_id from public.notifications where project_id=$1 and type in ('editing_overdue','delivery_overdue','payment_due')`, [project]))
    expect(types.filter((x) => x.type === 'editing_overdue').map((x) => x.recipient_employee_id)).toEqual(expect.arrayContaining([ids.editorEmp, ids.ownerEmp]))
    expect(types.filter((x) => x.type === 'delivery_overdue')).toHaveLength(3) // owner + 2 managers
    // payment notices go only to people with financial access (owner + the finance manager)
    const pay = types.filter((x) => x.type === 'payment_due').map((x) => x.recipient_employee_id).sort()
    expect(pay).toEqual([ids.ownerEmp, ids.managerFinEmp].sort())
    expect(new Set(types.map((x) => `${x.type}:${x.recipient_employee_id}`)).size).toBe(types.length)
  })
})

describe('project edits', () => {
  it('cancels removed events but keeps them for history, and releases their reminders', async () => {
    const project = await saveProject(ids.owner, payload({
      project: { name: 'Multi-event' }, initial_payment: null,
      events: [
        { title: 'Engagement', starts_at: hours(100), ends_at: hours(103), assignments: [{ employee_id: ids.photo1Emp, role: 'lead_photographer' }] },
        { title: 'Wedding', starts_at: hours(200), ends_at: hours(208), assignments: [{ employee_id: ids.photo1Emp, role: 'lead_photographer' }] },
      ],
    }))
    const evs = await t.rows<{ id: string; title: string }>(`select id, title from public.project_events where project_id=$1 order by starts_at`, [project])
    expect(evs).toHaveLength(2)
    const reminderCount = (await t.rows(`select 1 from public.event_reminders where event_id = any($1::uuid[]) and status='scheduled'`, [evs.map((e) => e.id)])).length
    expect(reminderCount).toBe(2) // reminders are scheduled separately for each event

    const edited = payload({
      project: { name: 'Multi-event (edited)' }, finance: { agreed_amount: 150000 }, initial_payment: null,
      events: [{ id: evs[1]!.id, title: 'Wedding', starts_at: hours(200), ends_at: hours(208), assignments: [{ employee_id: ids.photo1Emp, role: 'second_photographer' }] }],
    }) as Record<string, unknown>
    edited.removed_event_ids = [evs[0]!.id]
    await saveProject(ids.owner, edited, project)

    const after = await t.rows<{ title: string; cancelled_at: string | null }>(`select title, cancelled_at from public.project_events where project_id=$1 order by starts_at`, [project])
    expect(after[0]!.cancelled_at).not.toBeNull()
    expect(after[1]!.cancelled_at).toBeNull()
    const sched = await t.rows<{ event_id: string; status: string }>(`select event_id, status from public.event_reminders where event_id = any($1::uuid[]) order by status`, [evs.map((e) => e.id)])
    expect(sched.find((r) => r.event_id === evs[0]!.id)?.status).toBe('cancelled')
    expect(sched.find((r) => r.event_id === evs[1]!.id)?.status).toBe('scheduled')
    const role = await t.one<{ role: string }>(`select role from public.event_assignments where event_id=$1`, [evs[1]!.id])
    expect(role.role).toBe('second_photographer')
    expect(Number((await t.one<{ agreed_amount: string }>(`select agreed_amount from public.project_finance where project_id=$1`, [project])).agreed_amount)).toBe(150000)
  })

  it('rolls back the whole save when any part fails (atomic)', async () => {
    const before = Number((await t.one<{ n: string }>(`select count(*) as n from public.projects`)).n)
    const bad = payload({ events: [
      { title: 'OK', starts_at: hours(300), ends_at: hours(304) },
      { title: 'Broken', starts_at: hours(310), ends_at: hours(305) },
    ] })
    await t.as(ids.owner, () => t.fails(`select public.save_project(null,$1::jsonb)`, [JSON.stringify(bad)]))
    expect(Number((await t.one<{ n: string }>(`select count(*) as n from public.projects`)).n)).toBe(before)
  })
})

describe('changing the team after creation', () => {
  it('replaces the team atomically, notifies new people, withdraws reminders for removed ones', async () => {
    const project = await saveProject(ids.owner, payload({ project: { name: 'Team change' }, initial_payment: null, events: [{
      title: 'Ceremony', starts_at: hours(100), ends_at: hours(104),
      assignments: [{ employee_id: ids.photo1Emp, role: 'lead_photographer' }],
    }] }))
    const event = (await t.one<{ id: string }>(`select id from public.project_events where project_id=$1`, [project])).id

    await q(ids.owner, `select public.set_event_team($1, $2::jsonb)`, [event, JSON.stringify([
      { employee_id: ids.photo2Emp, role: 'lead_photographer' }, { employee_id: ids.editorEmp, role: 'editor' },
    ])])
    const team = await t.rows<{ employee_id: string; role: string }>(`select employee_id, role from public.event_assignments where event_id=$1 order by role`, [event])
    expect(team.map((x) => x.employee_id).sort()).toEqual([ids.editorEmp, ids.photo2Emp].sort())

    const rem = await t.rows<{ employee_id: string; status: string }>(`select employee_id, status from public.event_reminders where event_id=$1`, [event])
    expect(rem.find((r) => r.employee_id === ids.photo1Emp)?.status).toBe('cancelled')
    expect(rem.find((r) => r.employee_id === ids.photo2Emp)?.status).toBe('scheduled')
    const news = await t.rows<{ recipient_employee_id: string }>(`select recipient_employee_id from public.notifications where event_id=$1 and type='new_assignment'`, [event])
    expect(news.map((n) => n.recipient_employee_id)).toEqual(expect.arrayContaining([ids.photo2Emp, ids.editorEmp]))

    // changing someone's role is reported as an assignment change
    await q(ids.owner, `select public.set_event_team($1, $2::jsonb)`, [event, JSON.stringify([
      { employee_id: ids.photo2Emp, role: 'second_photographer' }, { employee_id: ids.editorEmp, role: 'editor' },
    ])])
    expect((await t.rows(`select 1 from public.notifications where event_id=$1 and type='assignment_changed' and recipient_employee_id=$2`, [event, ids.photo2Emp])).length).toBeGreaterThan(0)
  })

  it('is limited to owners and managers', async () => {
    const event = (await t.one<{ id: string }>(`select id from public.project_events limit 1`)).id
    expect(await t.as(ids.photo1, () => t.fails(`select public.set_event_team($1,'[]'::jsonb)`, [event]))).toMatch(/forbidden|not_found/)
    expect(await t.as(ids.otherOwner, () => t.fails(`select public.set_event_team($1,'[]'::jsonb)`, [event]))).toMatch(/forbidden|not_found/)
  })
})

describe('equipment', () => {
  it('keeps unique-asset and quantity rules, and never hard-deletes equipment that has history', async () => {
    expect(await t.as(ids.owner, () => t.fails(`insert into public.equipment (studio_id,name,asset_tag,quantity_owned) values ($1,'Tripod','CAM-001',1)`, [ids.studio]))).toMatch(/duplicate key/)
    expect(await t.as(ids.owner, () => t.fails(`insert into public.equipment (studio_id,name,asset_tag,quantity_owned) values ($1,'Bad','X-1',3)`, [ids.studio]))).toMatch(/check/)
    // owners can't delete via the API at all; deactivate instead
    expect(await t.as(ids.owner, () => t.fails(`delete from public.equipment where id=$1`, [ids.camera]))).toMatch(/permission denied/)
    await q(ids.owner, `update public.equipment set is_active=false where id=$1`, [ids.camera])
    expect(await t.rows(`select 1 from public.event_equipment where equipment_id=$1`, [ids.camera]).then((r) => r.length)).toBeGreaterThan(0)
  })
})
