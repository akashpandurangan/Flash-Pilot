// A tiny in-memory stand-in for Supabase (auth + PostgREST), used ONLY to smoke-test the UI in a real browser.
// It intercepts network calls via Playwright; it is not part of the product.

const H = 3_600_000
const D = 24 * H
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()
const day = (offsetDays) => new Date(Date.now() + offsetDays * D).toISOString().slice(0, 10)

export const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  studio: '22222222-2222-4222-8222-222222222222',
  owner: 'e0000000-0000-4000-8000-000000000001',
  riya: 'e0000000-0000-4000-8000-000000000002',
  arjun: 'e0000000-0000-4000-8000-000000000003',
  meera: 'e0000000-0000-4000-8000-000000000004',
  dev: 'e0000000-0000-4000-8000-000000000005',
  c1: 'c0000000-0000-4000-8000-000000000001',
  c2: 'c0000000-0000-4000-8000-000000000002',
  c3: 'c0000000-0000-4000-8000-000000000003',
  p1: 'a0000000-0000-4000-8000-000000000001',
  p2: 'a0000000-0000-4000-8000-000000000002',
  p3: 'a0000000-0000-4000-8000-000000000003',
}

const studioRow = {
  id: ids.studio, name: 'Lumen Studio', logo_path: null, email: 'hello@lumen.studio', phone: '+91 98200 11223', address: '14 Linking Road', city: 'Mumbai', state: 'MH',
  timezone: 'Asia/Kolkata', currency: 'INR', onboarding_step: 4, onboarding_completed_at: iso(-30 * D), reminder_lead_hours: 24, created_at: iso(-60 * D),
  default_checklist: [{ title: 'Team confirmed', phase: 'preparation' }, { title: 'Shoot completed', phase: 'shoot' }, { title: 'Editing completed', phase: 'editing' }, { title: 'Delivery completed', phase: 'delivery' }],
}

const emp = (id, name, team_role, extra = {}) => ({
  id, studio_id: ids.studio, user_id: null, full_name: name, email: `${name.split(' ')[0].toLowerCase()}@lumen.studio`, phone: '+91 90000 0000' + id.slice(-1), job_title: null,
  team_role, access_role: null, can_view_financials: false, invite_status: 'none', invited_at: null, notes: null, is_active: true, created_at: iso(-50 * D), ...extra,
})

export function buildDb(role = 'owner') {
  const meId = role === 'owner' ? ids.owner : ids.riya
  const employees = [
    emp(ids.owner, 'Olivia Mehra', 'studio_manager', { user_id: role === 'owner' ? ids.user : null, access_role: 'owner', can_view_financials: true, invite_status: 'accepted', job_title: 'Studio owner' }),
    emp(ids.riya, 'Riya Kapoor', 'photographer', { user_id: role === 'owner' ? null : ids.user, access_role: 'photographer', invite_status: 'accepted' }),
    emp(ids.arjun, 'Arjun Nair', 'videographer'),
    emp(ids.meera, 'Meera Iyer', 'editor', { access_role: 'editor', invite_status: 'pending', user_id: '99999999-9999-4999-8999-999999999999' }),
    emp(ids.dev, 'Dev Shah', 'assistant', { is_active: false }),
  ]
  const clients = [
    { id: ids.c1, studio_id: ids.studio, full_name: 'Anita Sharma', phone: '+91 99999 11111', email: 'anita@example.com', address: 'Bandra West, Mumbai', notes: 'Prefers WhatsApp', archived_at: null, created_at: iso(-40 * D) },
    { id: ids.c2, studio_id: ids.studio, full_name: 'Rohan Mehta', phone: '+91 98888 22222', email: null, address: null, notes: null, archived_at: null, created_at: iso(-20 * D) },
    { id: ids.c3, studio_id: ids.studio, full_name: 'Priya Nair', phone: '+91 97777 33333', email: 'priya@example.com', address: null, notes: null, archived_at: null, created_at: iso(-3 * D) },
  ]
  const equipment = [
    { id: 'f0000000-0000-4000-8000-000000000001', studio_id: ids.studio, name: 'Sony A7 IV', category: 'still_camera', brand_model: 'ILCE-7M4', asset_tag: 'CAM-001', quantity_owned: 1, condition: 'excellent', notes: null, is_active: true, created_at: iso(-90 * D) },
    { id: 'f0000000-0000-4000-8000-000000000002', studio_id: ids.studio, name: '24-70mm f/2.8 GM', category: 'lens', brand_model: 'Sony', asset_tag: 'LNS-014', quantity_owned: 1, condition: 'good', notes: null, is_active: true, created_at: iso(-90 * D) },
    { id: 'f0000000-0000-4000-8000-000000000003', studio_id: ids.studio, name: 'LED panel', category: 'lighting', brand_model: 'Aputure 300d', asset_tag: null, quantity_owned: 3, condition: 'good', notes: null, is_active: true, created_at: iso(-90 * D) },
  ]
  const brief = (e) => ({ id: e.id, full_name: e.full_name, team_role: e.team_role, is_active: e.is_active, phone: e.phone })
  const asg = (eventId, e, r) => ({ id: `${eventId}-${e.id}`, event_id: eventId, employee_id: e.id, role: r, notes: null, employee: brief(e) })
  const gear = (eventId, i, q = 1) => ({ id: `${eventId}-g${i}`, event_id: eventId, equipment_id: equipment[i].id, custom_name: null, quantity: q, notes: null, equipment: { id: equipment[i].id, name: equipment[i].name, category: equipment[i].category, asset_tag: equipment[i].asset_tag, quantity_owned: equipment[i].quantity_owned, is_active: true, condition: equipment[i].condition } })

  const proj = (id, code, name, client, booking, stage, extra = {}) => ({
    id, studio_id: ids.studio, project_code: code, client_id: client.id, name, event_type: 'wedding', description: 'Three-day celebration in Udaipur.', internal_notes: 'Bride wants candid style.',
    booking_status: booking, production_stage: stage, editor_id: ids.meera, editing_due_date: day(10), delivery_due_date: day(25), confirmed_at: iso(-20 * D), cancelled_at: null, cancel_reason: null,
    production_started_at: null, shoot_completed_at: null, editing_started_at: null, editing_completed_at: null, ready_for_delivery_at: null, delivered_at: null, archived_at: null,
    created_at: iso(-25 * D), updated_at: iso(-1 * D), ...extra,
  })
  const projects = [
    proj(ids.p1, 'FP-0001', 'Sharma–Rao Wedding', clients[0], 'confirmed', 'editing', { production_started_at: iso(-6 * D), shoot_completed_at: iso(-5 * D), editing_started_at: iso(-4 * D), editing_due_date: day(-1) }),
    proj(ids.p2, 'FP-0002', 'Mehta Corporate Launch', clients[1], 'confirmed', 'upcoming', { event_type: 'corporate', editing_due_date: null, delivery_due_date: null, editor_id: null }),
    proj(ids.p3, 'FP-0003', 'Nair Maternity Shoot', clients[2], 'inquiry', 'upcoming', { event_type: 'maternity', confirmed_at: null, editor_id: null }),
  ]

  const events = [
    { id: 'b0000000-0000-4000-8000-000000000001', studio_id: ids.studio, project_id: ids.p1, title: 'Sangeet', event_type: 'reception', starts_at: iso(-7 * D), ends_at: iso(-7 * D + 5 * H), venue_name: 'The Leela Palace', venue_address: 'Udaipur', map_url: null, notes: null, sort_order: 0, cancelled_at: null },
    { id: 'b0000000-0000-4000-8000-000000000002', studio_id: ids.studio, project_id: ids.p1, title: 'Wedding ceremony', event_type: 'wedding', starts_at: iso(-6 * D), ends_at: iso(-6 * D + 8 * H), venue_name: 'The Leela Palace', venue_address: 'Udaipur', map_url: 'https://maps.app.goo.gl/x', notes: 'Baraat at 10am', sort_order: 1, cancelled_at: null },
    { id: 'b0000000-0000-4000-8000-000000000003', studio_id: ids.studio, project_id: ids.p2, title: 'Product launch', event_type: 'corporate', starts_at: iso(1 * D + 3 * H), ends_at: iso(1 * D + 9 * H), venue_name: 'Jio World Centre', venue_address: 'BKC, Mumbai', map_url: null, notes: null, sort_order: 0, cancelled_at: null },
    { id: 'b0000000-0000-4000-8000-000000000004', studio_id: ids.studio, project_id: ids.p2, title: 'After-party', event_type: 'other', starts_at: iso(1 * D + 4 * H), ends_at: iso(1 * D + 8 * H), venue_name: null, venue_address: null, map_url: null, notes: null, sort_order: 1, cancelled_at: null },
    { id: 'b0000000-0000-4000-8000-000000000005', studio_id: ids.studio, project_id: ids.p3, title: 'Maternity session', event_type: 'maternity', starts_at: iso(9 * D), ends_at: iso(9 * D + 3 * H), venue_name: 'Studio A', venue_address: 'Lumen Studio', map_url: null, notes: null, sort_order: 0, cancelled_at: null },
  ].map((e) => {
    const withTeam = {
      'b0000000-0000-4000-8000-000000000001': [asg(e.id, employees[1], 'lead_photographer'), asg(e.id, employees[2], 'videographer')],
      'b0000000-0000-4000-8000-000000000002': [asg(e.id, employees[1], 'lead_photographer'), asg(e.id, employees[2], 'videographer')],
      'b0000000-0000-4000-8000-000000000003': [asg(e.id, employees[1], 'lead_photographer')],
      'b0000000-0000-4000-8000-000000000004': [asg(e.id, employees[1], 'second_photographer')], // double-booked with Riya on the launch
      'b0000000-0000-4000-8000-000000000005': [],
    }[e.id]
    const withGear = e.id.endsWith('3') || e.id.endsWith('4') ? [gear(e.id, 0)] : e.id.endsWith('2') ? [gear(e.id, 0), gear(e.id, 2, 2)] : []
    return { ...e, event_assignments: withTeam, event_equipment: withGear }
  })

  const eventsFor = (pid) => events.filter((e) => e.project_id === pid)
  const overview = projects.map((p) => {
    const evs = eventsFor(p.id)
    const c = clients.find((x) => x.id === p.client_id)
    return {
      ...p, client_name: c.full_name, client_phone: c.phone, client_email: c.email, first_event_at: evs[0].starts_at, next_event_at: evs.find((e) => e.ends_at > iso(0))?.starts_at ?? null,
      last_event_at: evs.at(-1).ends_at, event_count: evs.length, assigned_employee_ids: [...new Set(evs.flatMap((e) => e.event_assignments.map((a) => a.employee_id)))],
    }
  })
  const financials = [
    { project_id: ids.p1, studio_id: ids.studio, agreed_amount: 250000, payment_due_date: day(-3), paid_amount: 100000, balance: 150000 },
    { project_id: ids.p2, studio_id: ids.studio, agreed_amount: 80000, payment_due_date: day(14), paid_amount: 80000, balance: 0 },
    { project_id: ids.p3, studio_id: ids.studio, agreed_amount: 0, payment_due_date: null, paid_amount: 0, balance: 0 },
  ]
  const payments = [
    { id: 'd0000000-0000-4000-8000-000000000001', studio_id: ids.studio, project_id: ids.p1, amount: 100000, paid_on: day(-20), method: 'upi', reference: 'UTR1234567', notes: null, is_advance: true, status: 'valid', voided_at: null, void_reason: null, recorded_by_name: 'Olivia Mehra', created_at: iso(-20 * D), project: { id: ids.p1, name: 'Sharma–Rao Wedding', project_code: 'FP-0001' } },
    { id: 'd0000000-0000-4000-8000-000000000002', studio_id: ids.studio, project_id: ids.p2, amount: 80000, paid_on: day(-2), method: 'bank_transfer', reference: 'NEFT-998', notes: null, is_advance: false, status: 'valid', voided_at: null, void_reason: null, recorded_by_name: 'Olivia Mehra', created_at: iso(-2 * D), project: { id: ids.p2, name: 'Mehta Corporate Launch', project_code: 'FP-0002' } },
  ]
  const tasks = (pid) => [
    ['Team confirmed', 'preparation', true], ['Shoot completed', 'shoot', true], ['Editing completed', 'editing', false], ['Delivery completed', 'delivery', false],
  ].map(([title, phase, done], i) => ({ id: `${pid}-t${i}`, project_id: pid, studio_id: ids.studio, title, phase, sort_order: i * 10, assignee_id: null, is_done: done, done_at: done ? iso(-3 * D) : null, done_by_name: done ? 'Olivia Mehra' : null }))
  const activity = [
    { id: 'l1', studio_id: ids.studio, project_id: ids.p1, entity_type: 'project', action: 'workflow_start_editing', summary: 'Moved into editing', category: 'general', actor_name: 'Olivia Mehra', metadata: {}, created_at: iso(-4 * D), project: { name: 'Sharma–Rao Wedding' } },
    { id: 'l2', studio_id: ids.studio, project_id: ids.p1, entity_type: 'payment', action: 'advance_recorded', summary: 'Advance payment recorded', category: 'financial', actor_name: 'Olivia Mehra', metadata: { amount: 100000 }, created_at: iso(-20 * D), project: { name: 'Sharma–Rao Wedding' } },
    { id: 'l3', studio_id: ids.studio, project_id: ids.p2, entity_type: 'project', action: 'project_created', summary: 'Project created: Mehta Corporate Launch', category: 'general', actor_name: 'Olivia Mehra', metadata: {}, created_at: iso(-2 * D), project: { name: 'Mehta Corporate Launch' } },
  ]
  const notifications = [
    { id: 'n1', studio_id: ids.studio, recipient_employee_id: meId, type: 'event_reminder', title: 'Reminder: Product launch - Mehta Corporate Launch', body: 'Project: Mehta Corporate Launch (FP-0002)\nEvent: Product launch\nReporting time: Tomorrow, 11:00 AM Asia/Kolkata\nVenue: Jio World Centre, BKC, Mumbai\nYour role: Lead Photographer', link: `/projects/${ids.p2}`, project_id: ids.p2, event_id: null, read_at: null, created_at: iso(-1 * H), show_in_app: true },
    { id: 'n2', studio_id: ids.studio, recipient_employee_id: meId, type: 'editing_overdue', title: 'Editing overdue: Sharma–Rao Wedding', body: 'Editing was due yesterday.', link: `/projects/${ids.p1}`, project_id: ids.p1, event_id: null, read_at: iso(-2 * H), created_at: iso(-5 * H), show_in_app: true },
  ]
  const kpis = { active_projects: 2, inquiries: 1, upcoming_events: 3, today_events: 0, in_production: 0, pending_delivery: 1, outstanding_amount: role === 'owner' ? 150000 : null, stage_counts: { upcoming: 1, editing: 1 } }
  const deliveries = [
    { id: 'dl1', notification_id: 'n1', studio_id: ids.studio, channel: 'email', to_address: 'riya@lumen.studio', status: 'skipped', attempts: 1, max_attempts: 5, last_error: 'Email provider not configured (set RESEND_API_KEY and EMAIL_FROM).', sent_at: null, created_at: iso(-1 * H), notification: { title: 'Reminder: Product launch', type: 'event_reminder' } },
  ]

  return { meId, studio: studioRow, employees, clients, equipment, projects, overview, events, financials, payments, tasks, activity, notifications, kpis, deliveries, eventsFor }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ids.user, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.sig`
}

export async function installFakeSupabase(context, role = 'owner', log = []) {
  const db = buildDb(role)
  const state = { created: role !== 'new', step: role === 'new' ? 0 : 4, completed: role !== 'new' }
  const user = { id: ids.user, aud: 'authenticated', role: 'authenticated', email: 'owner@lumen.studio', email_confirmed_at: iso(-30 * D), app_metadata: {}, user_metadata: { full_name: 'Olivia Mehra' }, identities: [{}], created_at: iso(-60 * D) }
  const session = () => ({ access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token', user })

  const reply = (route, body, { status = 200, headers = {} } = {}) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...headers }, body: body === undefined ? '' : JSON.stringify(body) })

  await context.route('http://127.0.0.1:54321/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const q = url.searchParams
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })

    if (path.startsWith('/auth/v1/')) {
      if (path.endsWith('/token')) return reply(route, session())
      if (path.endsWith('/user')) return reply(route, user)
      if (path.endsWith('/logout')) return route.fulfill({ status: 204, headers: CORS })
      return reply(route, {})
    }
    if (path.startsWith('/functions/v1/')) return reply(route, { status: 'invited', message: 'Invitation sent.' })
    if (path.startsWith('/storage/')) return reply(route, {})

    const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(path)
    if (rpc) {
      log.push(`RPC ${rpc[1]}`)
      const body = req.postDataJSON?.() ?? {}
      if (rpc[1] === 'dashboard_kpis') return reply(route, db.kpis)
      if (rpc[1] === 'create_studio') { state.created = true; state.step = 2; db.studio.name = body.p_name; return reply(route, ids.studio) }
      if (rpc[1] === 'save_onboarding_step') { state.step = Math.max(state.step, body.p_step); return reply(route, null) }
      if (rpc[1] === 'complete_onboarding') { state.completed = true; state.step = 4; return reply(route, null) }
      return reply(route, null)
    }

    const table = /^\/rest\/v1\/([a-z_]+)$/.exec(path)?.[1]
    if (!table) return reply(route, [])
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) {
      log.push(`${req.method()} ${table}`)
      const sent = req.postDataJSON?.() ?? {}
      const base = table === 'employees' ? { ...db.employees[0], ...sent, id: sent.id ?? ids.owner } : table === 'studios' ? { ...db.studio, ...sent } : { id: 'new-id', ...sent }
      const wantsRep = (req.headers()['prefer'] ?? '').includes('return=representation')
      if (!wantsRep) return route.fulfill({ status: 204, headers: CORS })
      return reply(route, (req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? base : [base], { status: req.method() === 'POST' ? 201 : 200 })
    }
    const eq = (k) => (q.get(k) ?? '').replace(/^eq\./, '')
    const select = q.get('select') ?? ''
    let rows = []
    switch (table) {
      case 'employees':
        if (select.includes('studio:studios')) {
          if (role === 'inactive') rows = [{ ...db.employees[1], user_id: ids.user, is_active: false, studio: null }]
          else if (!state.created) rows = []
          else rows = db.employees.filter((e) => e.user_id === ids.user || (role === 'new' && e.id === ids.owner)).map((e) => ({ ...e, user_id: ids.user, studio: { ...db.studio, onboarding_step: state.step, onboarding_completed_at: state.completed ? iso(0) : null } }))
        } else rows = db.employees.filter((e) => role !== 'new' || e.id === ids.owner || state.step >= 3)
        break
      case 'clients': rows = eq('id') ? db.clients.filter((c) => c.id === eq('id')) : db.clients; break
      case 'projects': rows = db.projects.filter((p) => !eq('id') || p.id === eq('id')).map((p) => ({ ...p, editor: db.employees.find((e) => e.id === p.editor_id) ?? null, project_events: db.eventsFor(p.id) })); break
      case 'project_overview': rows = db.overview.filter((p) => (!eq('id') || p.id === eq('id')) && (!eq('client_id') || p.client_id === eq('client_id'))); break
      case 'project_events': rows = db.events.map((e) => ({ ...e, project: db.projects.find((p) => p.id === e.project_id) })); break
      case 'project_financials': rows = db.financials.filter((f) => !eq('project_id') || f.project_id === eq('project_id')); break
      case 'project_finance': rows = db.financials.filter((f) => !eq('project_id') || f.project_id === eq('project_id')).map((f) => ({ ...f, payment_notes: null })); break
      case 'payments': rows = db.payments.filter((p) => !eq('project_id') || p.project_id === eq('project_id')); break
      case 'production_tasks': rows = db.tasks(eq('project_id') || ids.p1); break
      case 'project_deliveries': rows = []; break
      case 'equipment': rows = db.equipment; break
      case 'activity_logs': rows = db.activity.filter((a) => !eq('project_id') || a.project_id === eq('project_id')); break
      case 'notifications': rows = db.notifications.filter((n) => !(q.get('read_at') === 'is.null') || !n.read_at); break
      case 'notification_deliveries': rows = db.deliveries; break
      case 'event_reminders': rows = []; break
      default: rows = []
    }
    log.push(`GET ${table}`)
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const headers = { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }
    if (wantsObject) return reply(route, rows[0] ?? null, { headers })
    return reply(route, rows, { headers })
  })
  return db
}
