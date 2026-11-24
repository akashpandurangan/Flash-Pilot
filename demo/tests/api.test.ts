import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PAGE_SIZE } from '@/lib/constants'
import { errorMessage, isOverpaymentError } from '@/lib/errors'
import { createClient, findDuplicateClients, listAllClients, listClientProjects, listClients, setClientArchived, updateClient } from '../src/api/clients'
import { getDashboardKpis, globalSearch } from '../src/api/dashboard'
import { createEmployee, inviteEmployee, listEmployees, revokeAccess, updateAccess, updateEmployee } from '../src/api/employees'
import { createEquipment, updateEquipment } from '../src/api/equipment'
import { countUnread, listDeliveries, listNotifications, markAllRead, markRead } from '../src/api/notifications'
import { getProjectFinancials, listFinancials, listPaymentsInRange, listProjectPayments, recordPayment, updateFinance, voidPayment } from '../src/api/payments'
import {
  cancelEvent, getProject, listActiveProjects, listProjectActivity, listProjects, listRecentActivity, listTasks, runWorkflowAction, saveProject, setBookingStatus,
  setEventTeam, setProjectArchived, setTaskDone, addTask, deleteTask, getDelivery, saveDelivery, updateProjectFields, listEventReminders,
} from '../src/api/projects'
import { listInventory, listScheduleEvents } from '../src/api/schedule'
import { fetchMemberships, fetchProfile, updateProfile, updateStudio, validateLogo } from '../src/api/studio'
import { onDataChange } from '../src/store/access'
import { DEMO_OWNER_ID, DEMO_STUDIO_ID, setLatency, setNow } from '../src/store/core'
import { getDb, resetDb } from '../src/store/db'
import type { ProjectFilters, ProjectPayload } from '@/api/projects'

// 24 Nov 2026, 14:00 in the studio's time zone (08:30 UTC). Seed dates are relative to this instant.
const NOW = new Date('2026-11-24T08:30:00.000Z')
const S = DEMO_STUDIO_ID
const base: ProjectFilters = { studioId: S, archived: false, sort: 'newest', page: 1 }

beforeEach(() => {
  setLatency(0)
  setNow(NOW)
  resetDb()
})
afterEach(() => setNow(null))

const byName = async (name: string) => {
  const all = await listActiveProjects(S, 1000)
  const found = all.find((p) => p.name === name)
  if (!found) throw new Error(`no project named ${name}`)
  return found
}
const empId = (name: string) => getDb().employees.find((e) => e.full_name === name)!.id
const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: { message: string; code?: string }) => e)

describe('seed data', () => {
  it('is a complete, internally consistent studio', () => {
    const db = getDb()
    expect(db.studio.name).toBe('Lumen Studio')
    expect(db.studio.timezone).toBe('Asia/Kolkata')
    expect(db.employees.length).toBe(10)
    expect(db.clients.length).toBe(14)
    expect(db.projects.length).toBe(21)
    expect(db.equipment.length).toBe(16)
    const ids = new Set(db.projects.map((p) => p.id))
    expect(db.events.every((e) => ids.has(e.project_id))).toBe(true)
    expect(db.payments.every((p) => ids.has(p.project_id))).toBe(true)
    expect(db.tasks.every((t) => ids.has(t.project_id))).toBe(true)
    expect(db.assignments.every((a) => db.events.some((e) => e.id === a.event_id) && db.employees.some((e) => e.id === a.employee_id))).toBe(true)
    expect(db.eventEquipment.every((q) => !q.equipment_id || db.equipment.some((e) => e.id === q.equipment_id))).toBe(true)
    expect(new Set(db.projects.map((p) => p.project_code)).size).toBe(21)
    expect(db.tasks.filter((t) => t.project_id === db.projects[0]!.id).length).toBe(10)
  })

  it('contains only fictional contact details', () => {
    const db = getDb()
    const emails = [...db.employees.map((e) => e.email), ...db.clients.map((c) => c.email), db.studio.email, db.profile.email].filter(Boolean) as string[]
    expect(emails.length).toBeGreaterThan(20)
    expect(emails.every((e) => /@([a-z0-9-]+\.)*(example|example\.com)$/.test(e))).toBe(true)
    const phones = [...db.employees.map((e) => e.phone), ...db.clients.map((c) => c.phone), db.studio.phone].filter(Boolean) as string[]
    expect(phones.every((p) => /^\+91 555\d\d \d{5}$/.test(p))).toBe(true)
    const links = db.deliveries.map((d) => d.link_url).filter(Boolean) as string[]
    expect(links.every((l) => l.startsWith('https://gallery.lumenstudio.example/'))).toBe(true)
  })

  it('covers every lifecycle stage, an inquiry, a cancelled, an archived event and a void payment', () => {
    const db = getDb()
    const stages = new Set(db.projects.filter((p) => p.booking_status === 'confirmed').map((p) => p.production_stage))
    for (const s of ['upcoming', 'production', 'awaiting_approval', 'editing', 'out_for_delivery', 'delivered']) expect(stages.has(s as never)).toBe(true)
    expect(db.projects.some((p) => p.booking_status === 'inquiry')).toBe(true)
    expect(db.projects.some((p) => p.booking_status === 'cancelled')).toBe(true)
    expect(db.projects.some((p) => p.archived_at)).toBe(true)
    expect(db.payments.some((p) => p.status === 'void')).toBe(true)
    expect(db.employees.some((e) => !e.is_active)).toBe(true)
    expect(db.employees.some((e) => e.invite_status === 'pending')).toBe(true)
    expect(db.clients.some((c) => c.archived_at)).toBe(true)
  })

  it('is rebuilt relative to today, so the dates always look current', () => {
    setNow(new Date('2027-03-02T08:30:00.000Z'))
    resetDb()
    const sessions = getDb().events.filter((e) => e.title === 'Wedding ceremony' && e.project_id === getDb().projects.find((p) => p.name === 'Deshmukh Wedding')!.id)
    expect(sessions[0]!.starts_at).toBe('2027-03-02T11:30:00.000Z') // 17:00 IST today
  })
})

describe('session and membership', () => {
  it('signs the visitor in as the studio owner with full access', async () => {
    const [m] = await fetchMemberships('anything')
    expect(m!.employee.id).toBe(DEMO_OWNER_ID)
    expect(m!.employee.access_role).toBe('owner')
    expect(m!.employee.can_view_financials).toBe(true)
    expect(m!.studio!.onboarding_completed_at).not.toBeNull()
    expect((await fetchProfile('x'))!.full_name).toBe('Olivia Mehra')
  })

  it('keeps the profile and the owner record in step', async () => {
    await updateProfile('x', { full_name: '  Olivia M.  ', phone: '' })
    expect((await fetchProfile('x'))!.phone).toBeNull()
    expect((await listEmployees(S)).find((e) => e.id === DEMO_OWNER_ID)!.full_name).toBe('Olivia M.')
  })

  it('updates studio settings', async () => {
    const s = await updateStudio(S, { name: ' Lumen Studio Mumbai ', city: '', reminder_lead_hours: 12 })
    expect(s.name).toBe('Lumen Studio Mumbai')
    expect(s.city).toBeNull()
    expect(s.reminder_lead_hours).toBe(12)
  })

  it('validates logo files', () => {
    expect(validateLogo({ type: 'image/gif', size: 10 } as File)).toMatch(/PNG, JPG or WebP/)
    expect(validateLogo({ type: 'image/png', size: 3 * 1024 * 1024 } as File)).toMatch(/2 MB/)
    expect(validateLogo({ type: 'image/webp', size: 1024 } as File)).toBeNull()
  })
})

describe('dashboard numbers', () => {
  it('match the rules of the real dashboard_kpis function', async () => {
    const k = await getDashboardKpis(S)
    const db = getDb()
    const open = db.projects.filter((p) => !p.archived_at)
    expect(k.inquiries).toBe(open.filter((p) => p.booking_status === 'inquiry').length)
    expect(k.active_projects).toBe(open.filter((p) => p.booking_status === 'confirmed' && p.production_stage !== 'delivered').length)
    expect(k.today_events).toBe(2) // Deshmukh Wedding and Khanna Corporate Portraits
    expect(k.in_production).toBe(2)
    expect(k.ready_for_delivery).toBe(1)
    expect(k.pending_delivery).toBe(open.filter((p) => p.booking_status === 'confirmed' && ['editing', 'out_for_delivery'].includes(p.production_stage)).length)
    expect(Object.values(k.stage_counts).reduce((a, b) => a + (b ?? 0), 0)).toBe(open.filter((p) => p.booking_status !== 'cancelled').length)
    const fin = await listFinancials(S)
    const owed = open.filter((p) => p.booking_status === 'confirmed').reduce((sum, p) => sum + Math.max(fin.find((f) => f.project_id === p.id)!.balance, 0), 0)
    expect(k.outstanding_amount).toBe(owed)
    expect(owed).toBeGreaterThan(1_000_000)
  })

  it('updates when something changes', async () => {
    const before = await getDashboardKpis(S)
    const p = await byName('Menon Wedding')
    await recordPayment(p.id, { amount: 50000, paid_on: '2026-11-24', method: 'upi' })
    const after = await getDashboardKpis(S)
    expect(after.outstanding_amount).toBe(before.outstanding_amount! - 50000)
  })
})

describe('lifecycle clock (what the per-minute scheduler does)', () => {
  it('moves a confirmed event into production at its first session and to approval after its last', async () => {
    setNow(new Date('2026-11-24T03:00:00.000Z')) // 08:30 IST: Khanna (12:30 IST) has not started
    resetDb()
    expect((await byName('Khanna Corporate Portraits')).production_stage).toBe('upcoming')
    expect((await getDashboardKpis(S)).in_production).toBe(1)
    setNow(new Date('2026-11-24T08:30:00.000Z')) // 14:00 IST
    const khanna = await byName('Khanna Corporate Portraits')
    expect(khanna.production_stage).toBe('production')
    expect(khanna.production_start_applied_at).not.toBeNull()
    expect((await listProjectActivity(khanna.id)).some((a) => a.summary.startsWith('Production started automatically'))).toBe(true)
    setNow(new Date('2026-11-24T11:00:00.000Z')) // 16:30 IST: Khanna's session has ended
    expect((await byName('Khanna Corporate Portraits')).production_stage).toBe('awaiting_approval')
  })

  it('never advances inquiries, cancelled or archived events', async () => {
    setNow(new Date('2027-06-01T08:30:00.000Z'))
    const rows = await listActiveProjects(S, 1000)
    expect(rows.find((p) => p.name === 'Kulkarni Pre-wedding')!.production_stage).toBe('upcoming')
    expect(rows.find((p) => p.name === 'Menon Anniversary Portraits')!.production_stage).toBe('upcoming')
  })

  it('honours a manual step back (the applied markers stay set)', async () => {
    const khanna = await byName('Khanna Corporate Portraits')
    expect(khanna.production_stage).toBe('production')
    await runWorkflowAction(khanna.id, 'revert')
    expect((await byName('Khanna Corporate Portraits')).production_stage).toBe('upcoming')
  })
})

describe('projects: list, filter, sort, page', () => {
  it('lists non-archived events, 20 per page', async () => {
    const p1 = await listProjects(base)
    expect(p1.total).toBe(20)
    expect(p1.rows.length).toBe(PAGE_SIZE)
    expect((await listProjects({ ...base, page: 2 })).rows.length).toBe(0)
    const archived = await listProjects({ ...base, archived: true })
    expect(archived.rows.map((r) => r.name)).toEqual(['Kapoor Engagement'])
  })

  it('searches name, client and code, ignoring case', async () => {
    expect((await listProjects({ ...base, search: 'deshmukh' })).rows.map((r) => r.name)).toEqual(['Deshmukh Wedding'])
    expect((await listProjects({ ...base, search: 'RAHUL MENON' })).total).toBe(3)
    expect((await listProjects({ ...base, search: 'FP-0007' })).rows[0]!.name).toBe('Rahman Wedding')
    expect((await listProjects({ ...base, search: 'zzzz-nothing' })).total).toBe(0)
  })

  it('filters by stage (excluding cancelled), booking, type and team member', async () => {
    const editing = await listProjects({ ...base, stage: 'editing' })
    expect(editing.rows.map((r) => r.name).sort()).toEqual(['Menon Engagement', 'Northwind Labs Offsite', 'Rahman Wedding'])
    expect((await listProjects({ ...base, booking: 'cancelled' })).rows.length).toBe(1)
    expect((await listProjects({ ...base, booking: 'inquiry' })).rows.length).toBe(2)
    expect((await listProjects({ ...base, stage: 'upcoming' })).rows.some((r) => r.booking_status === 'cancelled')).toBe(false)
    expect((await listProjects({ ...base, eventType: 'corporate' })).rows.every((r) => r.event_type === 'corporate')).toBe(true)
    const naina = await listProjects({ ...base, employeeId: empId('Rohan Iyer') })
    expect(naina.total).toBeGreaterThan(5)
    expect(naina.rows.every((r) => r.assigned_employee_ids.includes(empId('Rohan Iyer')))).toBe(true)
  })

  it('filters by date range using first and last session', async () => {
    const r = await listProjects({ ...base, from: '2026-11-24T00:00:00.000Z', to: '2026-11-25T23:59:00.000Z' })
    expect(r.rows.map((x) => x.name).sort()).toEqual(['Deshmukh Wedding', 'Khanna Corporate Portraits'])
    // the dinner on the 26th is only inside a wider window
    expect((await listProjects({ ...base, from: '2026-11-24T00:00:00.000Z', to: '2026-11-26T23:59:00.000Z' })).rows.map((x) => x.name)).toContain('Chopra Anniversary Dinner')
  })

  it('sorts: soonest, latest, name, newest', async () => {
    const names = async (sort: ProjectFilters['sort']) => (await listProjects({ ...base, sort })).rows.map((r) => r.name)
    const soonest = await names('soonest')
    expect(soonest.slice(0, 2)).toEqual(['Khanna Corporate Portraits', 'Deshmukh Wedding'])
    expect(soonest.indexOf('Nambiar Wedding')).toBeGreaterThan(soonest.indexOf('Menon Wedding')) // finished events after upcoming ones
    expect((await names('name'))[0]).toBe('Bhargava Wedding')
    expect((await names('latest'))[0]).toBe('Tandon Family Birthday') // the furthest-out first session
    expect((await names('newest'))[0]).toBe('Tandon Family Birthday')
  })

  it('returns the overview fields the list screens need', async () => {
    const p = await byName('Deshmukh Wedding')
    expect(p.client_name).toBe('Aanya Deshmukh')
    expect(p.event_count).toBe(4)
    expect(p.first_event_at! < p.last_event_at!).toBe(true)
    expect(p.assigned_employee_ids.length).toBe(5)
  })
})

describe('payments', () => {
  it('records a payment and recomputes the balance', async () => {
    const p = await byName('Deshmukh Wedding')
    expect((await getProjectFinancials(p.id))!.balance).toBe(230000)
    await recordPayment(p.id, { amount: 30000, paid_on: '2026-11-24', method: 'upi', reference: ' UPI-1 ', notes: '' })
    const f = (await getProjectFinancials(p.id))!
    expect(f.paid_amount).toBe(280000)
    expect(f.balance).toBe(200000)
    const [latest] = await listProjectPayments(p.id)
    expect(latest).toMatchObject({ amount: 30000, reference: 'UPI-1', notes: null, status: 'valid', recorded_by_name: 'Olivia Mehra', is_advance: false })
    expect((await listProjectActivity(p.id))[0]).toMatchObject({ summary: 'Payment recorded', category: 'financial' })
  })

  it('labels an advance', async () => {
    const p = await byName('Fernandes Engagement')
    await recordPayment(p.id, { amount: 1000, paid_on: '2026-11-24', method: 'cash', is_advance: true })
    expect((await listProjectActivity(p.id))[0]!.summary).toBe('Advance payment recorded')
  })

  it('refuses nonsense amounts with the same error tokens the real function raises', async () => {
    const p = await byName('Deshmukh Wedding')
    for (const amount of [0, -5, 10.123, Number.NaN]) {
      const err = await rejection(recordPayment(p.id, { amount, paid_on: '2026-11-24', method: 'cash' }))
      expect(err?.message).toMatch(/^invalid_amount:/)
      expect(errorMessage(err)).toMatch(/greater than zero/)
    }
  })

  it('refuses an overpayment unless it is explicitly allowed, and then shows a credit', async () => {
    const p = await byName('Deshmukh Wedding')
    const err = await rejection(recordPayment(p.id, { amount: 230000.01, paid_on: '2026-11-24', method: 'cash' }))
    expect(err?.message).toBe('overpayment: this payment exceeds the outstanding balance of 230000')
    expect(err?.code).toBe('P0001')
    expect(isOverpaymentError(err)).toBe(true)
    expect((await getProjectFinancials(p.id))!.balance).toBe(230000) // nothing was recorded
    await recordPayment(p.id, { amount: 230500, paid_on: '2026-11-24', method: 'cash', allow_overpayment: true })
    expect((await getProjectFinancials(p.id))!.balance).toBe(-500)
  })

  it('voids a payment: the balance returns and it cannot be voided twice', async () => {
    const p = await byName('Deshmukh Wedding')
    const pay = (await listProjectPayments(p.id))[0]!
    await voidPayment(pay.id, ' entered twice ')
    const f = (await getProjectFinancials(p.id))!
    expect(f.balance).toBe(230000 + pay.amount)
    const voided = (await listProjectPayments(p.id)).find((x) => x.id === pay.id)!
    expect(voided).toMatchObject({ status: 'void', void_reason: 'entered twice' })
    expect(voided.voided_at).not.toBeNull()
    expect((await listProjectActivity(p.id))[0]!.summary).toBe('Payment voided')
    expect((await rejection(voidPayment(pay.id)))?.message).toMatch(/already voided/)
  })

  it('updates the agreed amount and due date', async () => {
    const p = await byName('Deshmukh Wedding')
    await updateFinance(p.id, { agreed_amount: 500000, payment_due_date: '2026-12-01', payment_notes: 'Final 50% on delivery' })
    expect(await getProjectFinancials(p.id)).toMatchObject({ agreed_amount: 500000, balance: 250000, payment_due_date: '2026-12-01', payment_notes: 'Final 50% on delivery' })
  })

  it('lists payments in a date range, newest first, with their event', async () => {
    const rows = await listPaymentsInRange(S, '2026-11-01', '2026-11-30')
    expect(rows.length).toBeGreaterThan(3)
    expect(rows.every((r) => r.paid_on >= '2026-11-01' && r.paid_on <= '2026-11-30' && r.project)).toBe(true)
    expect([...rows].map((r) => r.paid_on)).toEqual([...rows].map((r) => r.paid_on).sort().reverse())
  })

  it('treats a missing event as not found', async () => {
    expect((await rejection(recordPayment('nope', { amount: 5, paid_on: '2026-11-24', method: 'cash' })))?.code).toBe('P0002')
  })
})

describe('booking status', () => {
  it('confirms an inquiry, then cancels it with a reason, then reopens it', async () => {
    const p = await byName('Kulkarni Pre-wedding')
    const confirmed = await setBookingStatus(p.id, 'confirmed')
    expect(confirmed).toMatchObject({ booking_status: 'confirmed', cancelled_at: null })
    expect(confirmed.confirmed_at).not.toBeNull()
    const cancelled = await setBookingStatus(p.id, 'cancelled', ' Dates clash ')
    expect(cancelled).toMatchObject({ booking_status: 'cancelled', cancel_reason: 'Dates clash' })
    const reopened = await setBookingStatus(p.id, 'inquiry')
    expect(reopened).toMatchObject({ booking_status: 'inquiry', cancelled_at: null, cancel_reason: null, confirmed_at: null })
    expect((await listProjectActivity(p.id)).slice(0, 3).map((a) => a.summary)).toEqual(['Booking moved back to inquiry', 'Booking cancelled', 'Booking confirmed'])
  })

  it('blocks impossible moves', async () => {
    const cancelled = getDb().projects.find((p) => p.booking_status === 'cancelled')!
    expect((await rejection(setBookingStatus(cancelled.id, 'confirmed')))?.message).toMatch(/^invalid_transition:/)
    const inProduction = await byName('Deshmukh Wedding')
    expect((await rejection(setBookingStatus(inProduction.id, 'inquiry')))?.message).toMatch(/production has already started/)
  })

  it('needs a session to confirm and refuses archived events', async () => {
    const p = await byName('Tandon Family Birthday')
    getDb().events.filter((e) => e.project_id === p.id).forEach((e) => { e.cancelled_at = '2026-11-01T00:00:00.000Z' })
    expect((await rejection(setBookingStatus(p.id, 'confirmed')))?.message).toMatch(/^events_required:/)
    const archived = getDb().projects.find((x) => x.archived_at)!
    expect((await rejection(setBookingStatus(archived.id, 'cancelled')))?.message).toMatch(/^project_archived:/)
  })
})

describe('production workflow', () => {
  it('walks an event through every stage and leaves a trail', async () => {
    const p = await byName('Chopra Anniversary Dinner')
    const step = async (action: Parameters<typeof runWorkflowAction>[1], expected: string, note?: string) => {
      const r = await runWorkflowAction(p.id, action, note)
      expect(r.production_stage).toBe(expected)
      return r
    }
    await step('start_production', 'production')
    const shot = await step('complete_shoot', 'awaiting_approval')
    expect(shot.shoot_completed_at).not.toBeNull()
    const approved = await step('approve_client', 'editing', 'All good')
    expect(approved).toMatchObject({ client_approval_note: 'All good', client_approved_by_name: 'Olivia Mehra' })
    const edited = await runWorkflowAction(p.id, 'complete_editing')
    expect(edited.editing_completed_at).not.toBeNull()
    await step('mark_out_for_delivery', 'out_for_delivery')
    const done = await step('mark_delivered', 'delivered')
    expect(done.delivered_at).not.toBeNull()
    expect(await getDelivery(p.id)).toMatchObject({ method: 'other', delivered_on: '2026-11-24' })
    expect((await listProjectActivity(p.id)).map((a) => a.summary).slice(0, 6)).toEqual([
      'Event delivered', 'Marked out for delivery', 'Editing marked completed', 'Client approval recorded - editing started',
      'Production completed - waiting for client approval', 'Production started',
    ])
  })

  it('refuses out-of-order steps with friendly messages', async () => {
    const p = await byName('Chopra Anniversary Dinner')
    const err = await rejection(runWorkflowAction(p.id, 'approve_client'))
    expect(err?.message).toBe('invalid_transition: The event is not waiting for client approval.')
    expect(errorMessage(err)).toBe('The event is not waiting for client approval.')
    expect((await rejection(runWorkflowAction(p.id, 'mark_delivered')))?.message).toMatch(/^invalid_transition:/)
    const inquiry = await byName('Kulkarni Pre-wedding')
    expect((await rejection(runWorkflowAction(inquiry.id, 'start_production')))?.message).toMatch(/^booking_not_confirmed:/)
    const archived = getDb().projects.find((x) => x.archived_at)!
    expect((await rejection(runWorkflowAction(archived.id, 'revert')))?.message).toMatch(/^project_archived:/)
  })

  it('needs editing finished before delivery', async () => {
    const menon = await byName('Menon Engagement')
    expect((await rejection(runWorkflowAction(menon.id, 'mark_out_for_delivery')))?.message).toMatch(/Finish editing first/)
    await runWorkflowAction(menon.id, 'complete_editing')
    expect((await rejection(runWorkflowAction(menon.id, 'complete_editing')))?.message).toMatch(/already completed/)
    expect((await runWorkflowAction(menon.id, 'mark_out_for_delivery')).production_stage).toBe('out_for_delivery')
  })

  it('steps back one stage at a time', async () => {
    const p = await byName('Chopra Pre-wedding') // out for delivery
    expect((await runWorkflowAction(p.id, 'revert')).production_stage).toBe('editing')
    expect((await runWorkflowAction(p.id, 'revert')).production_stage).toBe('awaiting_approval')
    const r = await runWorkflowAction(p.id, 'revert')
    expect(r).toMatchObject({ production_stage: 'production', shoot_completed_at: null })
    await runWorkflowAction(p.id, 'revert')
    expect((await rejection(runWorkflowAction(p.id, 'revert')))?.message).toMatch(/Nothing to step back/)
  })

  it('records delivery details separately and keeps the confirmation', async () => {
    const p = await byName('Chopra Pre-wedding')
    expect((await getDelivery(p.id))!.delivered_on).toBeNull()
    await saveDelivery(S, p.id, { method: 'download_link', delivered_on: '2026-11-25', link_url: ' https://gallery.lumenstudio.example/x ', notes: '' })
    expect(await getDelivery(p.id)).toMatchObject({ method: 'download_link', delivered_on: '2026-11-25', link_url: 'https://gallery.lumenstudio.example/x', notes: null })
    expect((await listProjectActivity(p.id))[0]!.summary).toBe('Delivery details updated')
  })
})

describe('tasks', () => {
  it('toggles a task and records who and when', async () => {
    const p = await byName('Bhargava Wedding')
    const task = (await listTasks(p.id)).find((t) => !t.is_done)!
    const done = await setTaskDone(task.id, true)
    expect(done).toMatchObject({ is_done: true, done_by_name: 'Olivia Mehra' })
    expect(done.done_at).not.toBeNull()
    expect((await listProjectActivity(p.id))[0]!.summary).toBe(`Completed: ${task.title}`)
    const reopened = await setTaskDone(task.id, false)
    expect(reopened).toMatchObject({ is_done: false, done_at: null, done_by_name: null })
    expect((await listProjectActivity(p.id))[0]!.summary).toBe(`Reopened: ${task.title}`)
  })

  it('adds, edits, orders and removes tasks', async () => {
    const p = await byName('Bhargava Wedding')
    const before = (await listTasks(p.id)).length
    const t = await addTask(S, p.id, '  Order canvas prints ', 'delivery', 5)
    expect(t.title).toBe('Order canvas prints')
    const list = await listTasks(p.id)
    expect(list.length).toBe(before + 1)
    expect(list.map((x) => x.sort_order)).toEqual([...list.map((x) => x.sort_order)].sort((a, b) => a - b))
    expect((await (await import('../src/api/projects')).updateTask(t.id, { assignee_id: empId('Kabir Sethi') })).assignee_id).toBe(empId('Kabir Sethi'))
    await deleteTask(t.id)
    expect((await listTasks(p.id)).length).toBe(before)
  })
})

describe('saving an event', () => {
  const payload = (clientId: string, extra: Partial<ProjectPayload> = {}): ProjectPayload => ({
    project: {
      studio_id: S, client_id: clientId, name: '  Test Anniversary  ', event_type: 'other', booking_status: 'confirmed', description: null, internal_notes: null,
      editor_id: null, editing_due_date: null, delivery_due_date: null,
    },
    finance: { agreed_amount: 50000, payment_due_date: '2026-12-31', payment_notes: null },
    initial_payment: { amount: 10000, paid_on: '2026-11-24', method: 'upi', reference: null, notes: null, allow_overpayment: false },
    events: [{
      title: 'Dinner', event_type: 'other', starts_at: '2026-12-05T13:30:00.000Z', ends_at: '2026-12-05T16:30:00.000Z', venue_name: 'Aurora Rooftop', venue_address: null, map_url: null, notes: null,
      sort_order: 0, assignments: [{ employee_id: empId('Rohan Iyer'), role: 'lead_photographer' }], equipment: [{ equipment_id: getDb().equipment[0]!.id, custom_name: null, quantity: 1 }],
    }],
    ...extra,
  })

  it('creates an event with a code, finance row, checklist, advance payment, team and gear', async () => {
    const client = getDb().clients[0]!
    const id = await saveProject(null, payload(client.id))
    const p = (await getProject(id))!
    expect(p).toMatchObject({ project_code: 'FP-0022', name: 'Test Anniversary', booking_status: 'confirmed', production_stage: 'upcoming' })
    expect(p.confirmed_at).not.toBeNull()
    expect(p.project_events.length).toBe(1)
    expect(p.project_events[0]!.event_assignments![0]!.employee!.full_name).toBe('Rohan Iyer')
    expect(p.project_events[0]!.event_equipment![0]!.equipment!.name).toBe(getDb().equipment[0]!.name)
    const tasks = await listTasks(id)
    expect(tasks.map((t) => t.sort_order)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
    expect(tasks.every((t) => !t.is_done)).toBe(true)
    expect(await getProjectFinancials(id)).toMatchObject({ agreed_amount: 50000, paid_amount: 10000, balance: 40000 })
    expect((await listProjectPayments(id))[0]!.is_advance).toBe(true)
    const log = (await listProjectActivity(id)).map((a) => a.summary)
    expect(log).toContain('Event created: Test Anniversary')
    expect(log).toContain('Advance payment recorded')
    expect(log).toContain('Rohan Iyer assigned to Dinner')
    expect((await listEventReminders([p.project_events[0]!.id])).length).toBe(1)
    // a second event gets the next code
    expect((await getProject(await saveProject(null, payload(client.id, { initial_payment: null }))))!.project_code).toBe('FP-0023')
  })

  it('validates the client, the sessions and the starting status', async () => {
    expect((await rejection(saveProject(null, payload('not-a-client'))))?.message).toMatch(/^invalid_client:/)
    const client = getDb().clients[0]!
    expect((await rejection(saveProject(null, payload(client.id, { events: [] }))))?.message).toMatch(/^events_required:/)
    const bad = payload(client.id)
    bad.project.booking_status = 'cancelled'
    expect((await rejection(saveProject(null, bad)))?.message).toMatch(/^invalid_transition:/)
  })

  it('changes nothing when any part of a save fails (all-or-nothing)', async () => {
    const client = getDb().clients[0]!
    const bad = payload(client.id)
    bad.events[0]!.assignments = [{ employee_id: 'ghost', role: 'lead_photographer' }]
    const before = JSON.stringify(getDb())
    expect(await rejection(saveProject(null, bad))).not.toBeNull()
    expect(JSON.stringify(getDb())).toBe(before)
    expect(getDb().projectSeq).toBe(21)
  })

  it('updates an event: edits a session, adds one, cancels (never deletes) a removed one, swaps the team', async () => {
    const detail = (await getProject((await byName('Fernandes Engagement')).id))!
    const ev = detail.project_events[0]!
    const rohan = empId('Rohan Iyer')
    const aditya = empId('Aditya Nair')
    const next: ProjectPayload = {
      project: { studio_id: S, client_id: detail.client_id, name: 'Fernandes Engagement Party', event_type: 'engagement', description: 'Updated', internal_notes: null, editor_id: empId('Naina Rao'), editing_due_date: '2026-12-20', delivery_due_date: '2026-12-30' },
      events: [
        { id: ev.id, title: ev.title, event_type: 'engagement', starts_at: '2026-12-03T12:30:00.000Z', ends_at: '2026-12-03T16:30:00.000Z', venue_name: 'Marigold House', venue_address: null, map_url: null, notes: null, sort_order: 0,
          assignments: [{ employee_id: aditya, role: 'lead_photographer' }], equipment: [] },
        { title: 'Dinner', event_type: 'other', starts_at: '2026-12-03T17:00:00.000Z', ends_at: '2026-12-03T19:00:00.000Z', venue_name: null, venue_address: null, map_url: null, notes: null, sort_order: 1, assignments: [{ employee_id: rohan, role: 'lead_photographer' }], equipment: [] },
      ],
    }
    await saveProject(detail.id, next)
    const after = (await getProject(detail.id))!
    expect(after.name).toBe('Fernandes Engagement Party')
    expect(after.project_events.length).toBe(2)
    expect(after.project_events[0]!.event_assignments!.map((a) => a.employee_id)).toEqual([aditya])
    expect(after.project_events[0]!.event_equipment).toEqual([])
    const log = (await listProjectActivity(detail.id)).map((a) => a.summary)
    expect(log).toContain('Session rescheduled: Engagement party')
    expect(log).toContain('Aditya Nair assigned to Engagement party')
    expect(log.some((l) => l.startsWith('Editor assigned'))).toBe(true)
    // remove the second session
    next.events = [{ ...next.events[0]! }]
    next.removed_event_ids = [after.project_events[1]!.id]
    await saveProject(detail.id, next)
    const final = (await getProject(detail.id))!
    expect(final.project_events.length).toBe(2)
    expect(final.project_events[1]!.cancelled_at).not.toBeNull()
    expect((await listProjectActivity(detail.id))[0]!.summary).toBe('Session cancelled: Dinner')
  })

  it('refuses to edit an archived event', async () => {
    const archived = getDb().projects.find((x) => x.archived_at)!
    expect((await rejection(saveProject(archived.id, payload(archived.client_id))))?.message).toMatch(/^project_archived:/)
  })

  it('archives and restores', async () => {
    const p = await byName('Nambiar Wedding')
    await setProjectArchived(p.id, true)
    expect((await listProjects({ ...base, search: 'Nambiar' })).total).toBe(0)
    expect((await listProjects({ ...base, archived: true })).total).toBe(2)
    await setProjectArchived(p.id, false)
    expect((await listProjects({ ...base, search: 'Nambiar' })).total).toBe(1)
    expect((await listProjectActivity(p.id)).slice(0, 2).map((a) => a.summary)).toEqual(['Event restored from archive', 'Event archived'])
  })

  it('updates the production plan fields and logs an editor change', async () => {
    const p = await byName('Bhargava Wedding')
    const updated = await updateProjectFields(p.id, { editor_id: empId('Dev Malhotra'), editing_due_date: '2026-12-30', internal_notes: 'Call the resort' })
    expect(updated).toMatchObject({ editing_due_date: '2026-12-30', internal_notes: 'Call the resort' })
    expect((await listProjectActivity(p.id))[0]!.summary).toBe('Editor assigned: Dev Malhotra')
  })
})

describe('teams and sessions', () => {
  it('replaces a session team and logs who joined and left', async () => {
    const detail = (await getProject((await byName('Chopra Anniversary Dinner')).id))!
    const ev = detail.project_events[0]!
    expect(ev.event_assignments).toEqual([])
    await setEventTeam(ev.id, [{ employee_id: empId('Rohan Iyer'), role: 'lead_photographer' }, { employee_id: empId('Kabir Sethi'), role: 'assistant' }])
    await setEventTeam(ev.id, [{ employee_id: empId('Rohan Iyer'), role: 'lead_photographer' }])
    const after = (await getProject(detail.id))!.project_events[0]!
    expect(after.event_assignments!.length).toBe(1)
    const log = (await listProjectActivity(detail.id)).map((a) => a.summary)
    expect(log[0]).toBe('Kabir Sethi removed from Anniversary dinner')
    expect(log).toContain('Rohan Iyer assigned to Anniversary dinner')
    expect((await listEventReminders([ev.id])).length).toBe(1)
  })

  it('does not assign deactivated people, cancelled sessions or archived events', async () => {
    const ev = (await getProject((await byName('Chopra Anniversary Dinner')).id))!.project_events[0]!
    expect((await rejection(setEventTeam(ev.id, [{ employee_id: empId('Isha Verma'), role: 'assistant' }])))?.message).toMatch(/^employee_inactive:/)
    await cancelEvent(ev.id)
    expect((await rejection(setEventTeam(ev.id, [{ employee_id: empId('Rohan Iyer'), role: 'lead_photographer' }])))?.message).toMatch(/cancelled/)
    expect((await listProjectActivity(ev.project_id))[0]!.summary).toBe('Session cancelled: Anniversary dinner')
  })

  it('lists schedule events overlapping a window, with team, gear and project', async () => {
    const win = { studioId: S, from: '2026-11-24T00:00:00.000Z', to: '2026-11-24T23:59:59.000Z' }
    const events = await listScheduleEvents(win)
    expect(events.map((e) => e.title).sort()).toEqual(['Executive headshots', 'Haldi', 'Wedding ceremony']) // Mehendi was yesterday
    const wedding = events.find((e) => e.title === 'Wedding ceremony')!
    expect(wedding.project).toMatchObject({ name: 'Deshmukh Wedding', project_code: 'FP-0010' })
    expect(wedding.event_assignments!.length).toBe(5)
    expect(wedding.event_equipment!.length).toBeGreaterThan(3)
    await cancelEvent(wedding.id)
    expect((await listScheduleEvents(win)).length).toBe(2)
    expect((await listScheduleEvents({ ...win, includeCancelled: true })).length).toBe(3)
  })
})

describe('clients', () => {
  it('lists, searches (name, email, phone, digits), sorts and filters archived', async () => {
    const all = await listClients({ studioId: S, status: 'all', sort: 'name', page: 1 })
    expect(all.total).toBe(14)
    expect((await listClients({ studioId: S, status: 'active', sort: 'name', page: 1 })).total).toBe(13)
    expect((await listClients({ studioId: S, status: 'archived', sort: 'name', page: 1 })).rows[0]!.full_name).toBe('Kavya Reddy')
    expect((await listClients({ studioId: S, status: 'all', sort: 'name', page: 1, search: 'menon' })).total).toBe(1)
    expect((await listClients({ studioId: S, status: 'all', sort: 'name', page: 1, search: 'khanna-co.example' })).total).toBe(1)
    const phone = getDb().clients[2]!.phone!
    expect((await listClients({ studioId: S, status: 'all', sort: 'name', page: 1, search: phone.replace(/\D/g, '').slice(-6) })).rows[0]!.phone).toBe(phone)
    expect((await listClients({ studioId: S, status: 'all', sort: 'newest', page: 1 })).rows[0]!.full_name).toBe('Ishaan Kulkarni')
    expect((await listClients({ studioId: S, status: 'all', sort: 'oldest', page: 1 })).rows[0]!.full_name).toBe('Kavya Reddy')
  })

  it('creates, edits, archives and restores a client, and spots duplicates', async () => {
    const c = await createClient(S, { full_name: '  Test Person ', phone: '+91 55502 99999', email: 'Test.Person@Example.com', address: '', notes: '' })
    expect(c).toMatchObject({ full_name: 'Test Person', email: 'test.person@example.com', address: null, archived_at: null })
    expect((await findDuplicateClients(S, '+91 55502 99999', '')).map((x) => x.id)).toEqual([c.id])
    expect((await findDuplicateClients(S, '12', 'TEST.person@example.com')).map((x) => x.id)).toEqual([c.id])
    expect(await findDuplicateClients(S, '+91 55502 99999', '', c.id)).toEqual([])
    expect(await findDuplicateClients(S, '123', '')).toEqual([])
    const u = await updateClient(c.id, { full_name: 'Test P.', phone: '', email: '' })
    expect(u).toMatchObject({ full_name: 'Test P.', phone: null, email: null })
    await setClientArchived(c.id, true)
    expect((await listAllClients(S)).some((x) => x.id === c.id)).toBe(false)
    await setClientArchived(c.id, false)
    expect((await listAllClients(S)).some((x) => x.id === c.id)).toBe(true)
    expect((await listRecentActivity(S, 50)).some((a) => a.summary === 'Client added: Test Person' && a.project === null)).toBe(true)
  })

  it("lists a client's events, latest first", async () => {
    const rahul = getDb().clients.find((c) => c.full_name === 'Rahul Menon')!
    const rows = await listClientProjects(rahul.id)
    expect(rows.map((r) => r.name)).toEqual(['Menon Wedding', 'Menon Anniversary Portraits', 'Menon Engagement'])
  })
})

describe('team', () => {
  it('lists everyone by name, including inactive and pending', async () => {
    const list = await listEmployees(S)
    expect(list.length).toBe(10)
    expect(list.map((e) => e.full_name)).toEqual([...list.map((e) => e.full_name)].sort((a, b) => a.localeCompare(b)))
  })

  it('creates a member and refuses a duplicate email', async () => {
    const e = await createEmployee(S, { full_name: ' New Person ', email: 'NEW@lumenstudio.example', team_role: 'photographer' })
    expect(e).toMatchObject({ full_name: 'New Person', email: 'new@lumenstudio.example', is_active: true, access_role: null, invite_status: 'none' })
    const err = await rejection(createEmployee(S, { full_name: 'Another', email: 'new@lumenstudio.example', team_role: 'assistant' }))
    expect(err?.code).toBe('23505')
    expect(errorMessage(err)).toBe('Someone with that email already exists.')
  })

  it('protects the owner', async () => {
    expect((await rejection(updateEmployee(DEMO_OWNER_ID, { is_active: false })))?.message).toMatch(/^owner_protected:/)
    expect((await rejection(updateAccess(DEMO_OWNER_ID, { access_role: 'manager' })))?.message).toMatch(/^owner_protected:/)
    expect((await rejection(revokeAccess(DEMO_OWNER_ID)))?.message).toMatch(/^owner_protected:/)
  })

  it('invites locally (no email), changes access and revokes it', async () => {
    const kabir = empId('Kabir Sethi')
    const res = await inviteEmployee({ employeeId: kabir, accessRole: 'photographer', canViewFinancials: false })
    expect(res.status).toBe('invited')
    expect(res.message).toMatch(/no email was sent/i)
    expect((await listEmployees(S)).find((e) => e.id === kabir)).toMatchObject({ invite_status: 'pending', access_role: 'photographer' })
    expect((await updateAccess(kabir, { access_role: 'manager', can_view_financials: true })).access_role).toBe('manager')
    expect(await revokeAccess(kabir)).toMatchObject({ access_role: null, invite_status: 'none', can_view_financials: false, user_id: null })
    expect((await rejection(inviteEmployee({ employeeId: empId('Isha Verma'), accessRole: 'photographer', canViewFinancials: false })))?.message).toMatch(/^employee_inactive:/)
  })

  it('deactivates and edits a member', async () => {
    const id = empId('Samar Joshi')
    expect(await updateEmployee(id, { is_active: false, job_title: ' ', phone: '+91 55501 77777' })).toMatchObject({ is_active: false, job_title: null, phone: '+91 55501 77777' })
  })
})

describe('equipment', () => {
  it('forces one unit for a tagged asset and refuses a duplicate tag', async () => {
    const item = await createEquipment(S, { name: ' Spare battery ', category: 'other', quantity_owned: 5, condition: 'good', is_active: true, asset_tag: 'LS-BAT-01' })
    expect(item).toMatchObject({ name: 'Spare battery', quantity_owned: 1, asset_tag: 'LS-BAT-01' })
    const err = await rejection(createEquipment(S, { name: 'Clash', category: 'other', quantity_owned: 1, condition: 'good', is_active: true, asset_tag: 'ls-bat-01' }))
    expect(errorMessage(err)).toBe('Another item already uses that asset ID.')
    const updated = await updateEquipment(item.id, { name: 'Spare battery', category: 'other', quantity_owned: 5, condition: 'needs_repair', is_active: true, asset_tag: '' })
    expect(updated).toMatchObject({ quantity_owned: 5, asset_tag: null, condition: 'needs_repair' })
    expect((await listInventory(S)).length).toBe(17)
  })
})

describe('notifications', () => {
  it('counts, filters and marks as read', async () => {
    expect(await countUnread(DEMO_OWNER_ID)).toBe(4)
    expect((await listNotifications(DEMO_OWNER_ID, { unreadOnly: true })).length).toBe(4)
    const all = await listNotifications(DEMO_OWNER_ID)
    expect(all.length).toBe(12)
    expect(all.map((n) => n.created_at)).toEqual([...all.map((n) => n.created_at)].sort().reverse())
    await markRead([all.find((n) => !n.read_at)!.id])
    expect(await countUnread(DEMO_OWNER_ID)).toBe(3)
    await markRead([])
    await markAllRead(S)
    expect(await countUnread(DEMO_OWNER_ID)).toBe(0)
    expect((await listNotifications(DEMO_OWNER_ID, { limit: 3 })).length).toBe(3)
  })

  it('lists e-mail delivery outcomes without ever sending anything', async () => {
    const rows = await listDeliveries(S)
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['sent', 'processing', 'failed', 'pending', 'skipped']))
    expect(rows.every((r) => r.to_address.endsWith('.example') && r.notification)).toBe(true)
  })
})

describe('search and reminders', () => {
  it('searches across events, clients and team with limits', async () => {
    expect(await globalSearch(S, 'a', true, true)).toEqual({ projects: [], clients: [], employees: [] })
    const r = await globalSearch(S, 'men', true, true)
    expect(r.projects.map((p) => p.name)).toContain('Menon Engagement')
    expect(r.projects.length).toBeLessThanOrEqual(6)
    expect(r.clients.map((c) => c.full_name)).toEqual(['Rahul Menon'])
    expect(r.employees.map((e) => e.full_name)).toEqual([])
    expect((await globalSearch(S, 'naina', true, true)).employees[0]!.full_name).toBe('Naina Rao')
    expect((await globalSearch(S, 'naina', false, false)).employees).toEqual([])
    expect((await globalSearch(S, 'kavya', true, true)).clients).toEqual([]) // archived clients are left out
  })

  it('lists reminders for events', async () => {
    const wedding = (await getProject((await byName('Bhargava Wedding')).id))!.project_events[1]!
    const r = await listEventReminders([wedding.id])
    expect(r.length).toBe(5)
    expect(r.every((x) => x.status === 'scheduled' && x.remind_at < x.event_starts_at)).toBe(true)
    expect(await listEventReminders([])).toEqual([])
  })
})

describe('isolation of the store', () => {
  it('hands out copies: changing a result never changes the data', async () => {
    const [p] = (await listProjects(base)).rows
    p!.name = 'HACKED'
    const detail = (await getProject(p!.id))!
    detail.project_events.length = 0
    expect((await getProject(p!.id))!.name).not.toBe('HACKED')
    expect((await getProject(p!.id))!.project_events.length).toBeGreaterThan(0)
  })

  it('announces writes (not reads) to listeners, and a failing listener never undoes a write', async () => {
    let calls = 0
    const off = onDataChange(() => { calls++ })
    const bad = onDataChange(() => { throw new Error('listener bug') })
    const consoleError = console.error
    console.error = () => undefined
    try {
      await listAllClients(S)
      expect(calls).toBe(0)
      const c = await createClient(S, { full_name: 'Listener Probe', phone: '' })
      expect(calls).toBe(1)
      expect((await listAllClients(S)).some((x) => x.id === c.id)).toBe(true) // still saved
      await rejection(recordPayment('missing', { amount: 5, paid_on: '2026-11-24', method: 'cash' }))
      expect(calls).toBe(1) // a failed write announces nothing
    } finally {
      console.error = consoleError
      off()
      bad()
    }
  })

  it('resets to the starting data', async () => {
    const p = await byName('Menon Wedding')
    await recordPayment(p.id, { amount: 1000, paid_on: '2026-11-24', method: 'cash' })
    await createClient(S, { full_name: 'Temp', phone: '' })
    resetDb()
    expect((await getProjectFinancials(p.id))!.paid_amount).toBe(100000)
    expect((await listAllClients(S)).length).toBe(13)
  })

  it('looks up a missing event as nothing, not an error', async () => {
    expect(await getProject('missing')).toBeNull()
    expect(await getDelivery('missing')).toBeNull()
  })

  it('keeps the one studio and its checklist editable', async () => {
    const s = await updateStudio(S, { default_checklist: [{ title: 'Only step', phase: 'shoot' }] })
    expect(s.default_checklist.length).toBe(1)
    const client = getDb().clients[0]!
    const id = await saveProject(null, {
      project: { studio_id: S, client_id: client.id, name: 'X', event_type: 'other', description: null, internal_notes: null, editor_id: null, editing_due_date: null, delivery_due_date: null },
      events: [{ title: 'A', event_type: 'other', starts_at: '2026-12-05T13:30:00.000Z', ends_at: '2026-12-05T14:30:00.000Z', venue_name: null, venue_address: null, map_url: null, notes: null, sort_order: 0, assignments: [], equipment: [] }],
    })
    expect((await listTasks(id)).map((t) => t.title)).toEqual(['Only step'])
    expect((await getProject(id))!.booking_status).toBe('inquiry')
  })
})
