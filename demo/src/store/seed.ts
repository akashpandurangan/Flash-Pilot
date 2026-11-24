import { PRODUCTION_STAGES } from '@/lib/constants'
import type {
  AccessRole, ActivityLog, AppNotification, AssignmentRole, BookingStatus, Client, DeliveryMethod, Employee, Equipment, EquipmentCategory, EquipmentCondition,
  EventAssignment, EventEquipment, EventReminder, EventType, InviteStatus, NotificationDelivery, NotificationType, Payment, PaymentMethod, ProductionStage,
  ProductionTask, Project, ProjectDelivery, ProjectEvent, ProjectFinance, TeamRole,
} from '@/types/entities'
import { DEMO_OWNER_ID, DEMO_STUDIO_ID, DEMO_USER_EMAIL, DEMO_USER_ID, DEMO_USER_NAME, now, seedId } from './core'
import type { Db } from './db'

/**
 * Sample data for "Lumen Studio", a fictional photography studio in Mumbai. Everything here is invented: the people, the
 * e-mail addresses (reserved `.example` domains), the phone numbers (a 555-style range no real mobile uses) and the venues.
 * Dates are relative to *today*, so the dashboard always looks live: sessions today and this week, an overdue edit, an
 * overdue delivery, a double-booked photographer, a double-booked drone, an unstaffed event, and so on.
 */

const DAY = 86_400_000
const IST = 330 * 60_000 // the studio's time zone (Asia/Kolkata) has no daylight saving, so a fixed offset is exact

const K = { emp: 0x11, user: 0x21, client: 0x12, project: 0x13, event: 0x14, assign: 0x15, gear: 0x16, eqRow: 0x17, payment: 0x18, task: 0x19, activity: 0x1a, notif: 0x1b, mail: 0x1c, remind: 0x1d }

type EmpKey = 'olivia' | 'rohan' | 'meera' | 'dev' | 'naina' | 'kabir' | 'tara' | 'aditya' | 'isha' | 'samar'
type ClientKey = 'aanya' | 'rahman' | 'priya' | 'arjun' | 'meghna' | 'harsh' | 'brightleaf' | 'saanvi' | 'rahul' | 'zoya' | 'northwind' | 'kavya' | 'tanvi' | 'ishaan'
type GearKey = 'a7iv1' | 'a7iv2' | 'r5' | 'fx3' | 'l2470' | 'l70200' | 'l35' | 'l85' | 'l24105' | 'drone' | 'gimbal' | 'godox' | 'v1' | 'mic' | 'tripod' | 'nikon'

interface SessionSpec {
  title: string
  day: number
  from: string
  to: string
  venue?: [name: string, address: string]
  type?: EventType
  notes?: string
  team?: [EmpKey, AssignmentRole][]
  gear?: ([GearKey, number] | [GearKey])[]
  customGear?: string
}

type PaymentSpec = [day: number, amount: number, method: PaymentMethod, opts?: { adv?: boolean; ref?: string; note?: string; void?: string; by?: string }]

interface ProjectSpec {
  name: string
  client: ClientKey
  type: EventType
  booking: BookingStatus
  stage: ProductionStage
  createdDay: number
  confirmedDay?: number
  sessions: SessionSpec[]
  agreed: number
  dueDay?: number
  payments?: PaymentSpec[]
  editor?: EmpKey
  editDueDay?: number
  deliveryDueDay?: number
  approvedDay?: number
  editedDay?: number
  outDay?: number
  deliveredDay?: number
  delivery?: { method: DeliveryMethod; link?: string; notes?: string; draftOnly?: boolean }
  description?: string
  internalNotes?: string
  cancelReason?: string
  cancelDay?: number
  archivedDay?: number
  paymentNotes?: string
}

const CHECKLIST: { title: string; phase: ProductionTask['phase'] }[] = [
  { title: 'Team confirmed', phase: 'preparation' },
  { title: 'Equipment prepared', phase: 'preparation' },
  { title: 'Shoot completed', phase: 'shoot' },
  { title: 'Photos backed up', phase: 'shoot' },
  { title: 'Photo selection completed', phase: 'post' },
  { title: 'Editing completed', phase: 'editing' },
  { title: 'Client review completed', phase: 'delivery' },
  { title: 'Final files exported', phase: 'editing' },
  { title: 'Album printing completed', phase: 'delivery' },
  { title: 'Delivery completed', phase: 'delivery' },
]

export function buildSeed(): Db {
  const at = now()
  const dayStart = (offset: number) => (Math.floor((at.getTime() + IST) / DAY) + offset) * DAY - IST
  const when = (offset: number, hhmm = '10:00') => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number]
    return new Date(dayStart(offset) + (h * 60 + m) * 60_000).toISOString()
  }
  const dateOnly = (offset: number) => new Date(dayStart(offset) + IST).toISOString().slice(0, 10)
  const nowIso = at.toISOString()
  const clampPast = (iso: string) => (iso > nowIso ? nowIso : iso)

  // ---------------------------------------------------------------- team
  const empDefs: { key: EmpKey; name: string; team: TeamRole; title: string; access: AccessRole | null; fin?: boolean; invite: InviteStatus; active?: boolean; notes?: string }[] = [
    { key: 'olivia', name: DEMO_USER_NAME, team: 'photographer', title: 'Founder & lead photographer', access: 'owner', fin: true, invite: 'accepted', notes: 'Shoots the main ceremony at most weddings.' },
    { key: 'rohan', name: 'Rohan Iyer', team: 'photographer', title: 'Senior photographer', access: 'photographer', invite: 'accepted', notes: 'Strong with low-light receptions.' },
    { key: 'meera', name: 'Meera Kapoor', team: 'photographer', title: 'Second photographer', access: 'photographer', invite: 'accepted' },
    { key: 'dev', name: 'Dev Malhotra', team: 'videographer', title: 'Cinematographer', access: 'photographer', invite: 'accepted', notes: 'Edits the highlight films too.' },
    { key: 'naina', name: 'Naina Rao', team: 'editor', title: 'Lead retoucher & editor', access: 'editor', invite: 'accepted' },
    { key: 'kabir', name: 'Kabir Sethi', team: 'assistant', title: 'Lighting & gear assistant', access: null, invite: 'none' },
    { key: 'tara', name: 'Tara Bhatt', team: 'studio_manager', title: 'Studio manager', access: 'manager', fin: true, invite: 'accepted' },
    { key: 'aditya', name: 'Aditya Nair', team: 'photographer', title: 'Freelance photographer', access: 'photographer', invite: 'pending', notes: 'Invited last week; has not signed in yet.' },
    { key: 'isha', name: 'Isha Verma', team: 'assistant', title: 'Assistant (on extended leave)', access: null, invite: 'none', active: false },
    { key: 'samar', name: 'Samar Joshi', team: 'videographer', title: 'Freelance drone pilot', access: null, invite: 'none', notes: 'Licensed drone operator, booked per job.' },
  ]
  const employees: Employee[] = empDefs.map((d, i) => ({
    id: d.key === 'olivia' ? DEMO_OWNER_ID : seedId(K.emp, i + 1),
    studio_id: DEMO_STUDIO_ID,
    user_id: d.key === 'olivia' ? DEMO_USER_ID : d.access ? seedId(K.user, i + 1) : null,
    full_name: d.name,
    email: `${d.name.split(' ')[0]!.toLowerCase()}@lumenstudio.example`,
    phone: `+91 55501 ${String(i + 1).padStart(5, '0')}`,
    job_title: d.title,
    team_role: d.team,
    access_role: d.access,
    can_view_financials: d.fin ?? false,
    invite_status: d.invite,
    invited_at: d.invite === 'none' ? null : when(d.invite === 'pending' ? -6 : -250, '10:30'),
    notes: d.notes ?? null,
    is_active: d.active ?? true,
    created_at: when(-300 + i, '09:00'),
  }))
  const emp = Object.fromEntries(empDefs.map((d, i) => [d.key, employees[i]!])) as Record<EmpKey, Employee>

  // ------------------------------------------------------------- clients
  const clientDefs: { key: ClientKey; name: string; email: string | null; address: string; notes?: string; archived?: boolean; day: number }[] = [
    { key: 'aanya', name: 'Aanya Deshmukh', email: 'aanya.deshmukh@example.com', address: '22 Linking Lane, Bandra West, Mumbai', notes: 'Prefers WhatsApp for updates. Wants a documentary, candid style.', day: -48 },
    { key: 'rahman', name: 'Vikram & Sana Rahman', email: 'rahman.family@example.com', address: '9 Marine Crescent, Mumbai', notes: 'Large family gathering; two grandparents need seated portraits.', day: -100 },
    { key: 'priya', name: 'Priya Nambiar', email: 'priya.nambiar@example.com', address: '41 Orchard Road, Powai, Mumbai', day: -115 },
    { key: 'arjun', name: 'Arjun Khanna', email: 'arjun@khanna-co.example', address: 'Khanna & Co., 5th Floor, Lower Parel, Mumbai', notes: 'Corporate contact. Invoices go to accounts@khanna-co.example.', day: -12 },
    { key: 'meghna', name: 'Meghna Pillai', email: 'meghna.pillai@example.com', address: '17 Palm Grove, Thane', day: -75 },
    { key: 'harsh', name: 'Harsh Tandon', email: 'harsh.tandon@example.com', address: '8 Cedar Heights, Andheri East, Mumbai', notes: 'Repeat client - booked a maternity shoot last year.', day: -72 },
    { key: 'brightleaf', name: 'Brightleaf Hospitality', email: 'events@brightleaf.example', address: 'Brightleaf House, Nariman Point, Mumbai', notes: 'Contact: Nisha Rao (events lead). Pays by bank transfer, 30-day terms.', day: -65 },
    { key: 'saanvi', name: 'Saanvi Chopra', email: 'saanvi.chopra@example.com', address: '63 Hillview Society, Juhu, Mumbai', day: -42 },
    { key: 'rahul', name: 'Rahul Menon', email: 'rahul.menon@example.com', address: '3 Lakeside Residency, Powai, Mumbai', day: -32 },
    { key: 'zoya', name: 'Zoya Fernandes', email: 'zoya.fernandes@example.com', address: '12 Seaview Apartments, Bandra, Mumbai', notes: 'Likes to approve a small preview set before the full gallery.', day: -58 },
    { key: 'northwind', name: 'Northwind Labs', email: 'marketing@northwind.example', address: 'Northwind Labs, Tech Park, Airoli, Navi Mumbai', notes: 'Marketing team books two or three shoots a year.', day: -28 },
    { key: 'kavya', name: 'Kavya Reddy', email: 'kavya.reddy@example.com', address: '27 Garden Court, Pune', notes: 'Moved abroad - kept for the records.', archived: true, day: -210 },
    { key: 'tanvi', name: 'Tanvi Bhargava', email: 'tanvi.bhargava@example.com', address: '5 Rosewood Villas, Lonavala', day: -14 },
    { key: 'ishaan', name: 'Ishaan Kulkarni', email: 'ishaan.kulkarni@example.com', address: '30 Maple Street, Pune', day: -3 },
  ]
  const clients: Client[] = clientDefs.map((d, i) => ({
    id: seedId(K.client, i + 1),
    studio_id: DEMO_STUDIO_ID,
    full_name: d.name,
    phone: `+91 55502 ${String(10001 + i)}`,
    email: d.email,
    address: d.address,
    notes: d.notes ?? null,
    archived_at: d.archived ? when(-90, '12:00') : null,
    created_at: when(d.day, '11:00'),
  }))
  const client = Object.fromEntries(clientDefs.map((d, i) => [d.key, clients[i]!])) as Record<ClientKey, Client>

  // ----------------------------------------------------------- equipment
  const gearDefs: { key: GearKey; name: string; cat: EquipmentCategory; model: string; tag: string | null; qty: number; cond: EquipmentCondition; notes?: string; active?: boolean }[] = [
    { key: 'a7iv1', name: 'Sony A7 IV - Body 1', cat: 'still_camera', model: 'Sony A7 IV', tag: 'LS-CAM-01', qty: 1, cond: 'excellent' },
    { key: 'a7iv2', name: 'Sony A7 IV - Body 2', cat: 'still_camera', model: 'Sony A7 IV', tag: 'LS-CAM-02', qty: 1, cond: 'good' },
    { key: 'r5', name: 'Canon EOS R5', cat: 'still_camera', model: 'Canon EOS R5', tag: 'LS-CAM-03', qty: 1, cond: 'excellent' },
    { key: 'fx3', name: 'Sony FX3 Cinema Camera', cat: 'video_camera', model: 'Sony FX3', tag: 'LS-VID-01', qty: 1, cond: 'excellent' },
    { key: 'l2470', name: '24-70mm f/2.8 GM II', cat: 'lens', model: 'Sony FE 24-70mm f/2.8 GM II', tag: 'LS-LNS-01', qty: 1, cond: 'excellent' },
    { key: 'l70200', name: '70-200mm f/2.8 GM OSS II', cat: 'lens', model: 'Sony FE 70-200mm f/2.8 GM OSS II', tag: 'LS-LNS-02', qty: 1, cond: 'good' },
    { key: 'l35', name: '35mm f/1.4 Art', cat: 'lens', model: 'Sigma 35mm f/1.4 DG DN Art', tag: 'LS-LNS-03', qty: 1, cond: 'good' },
    { key: 'l85', name: '85mm f/1.4 GM', cat: 'lens', model: 'Sony FE 85mm f/1.4 GM', tag: 'LS-LNS-04', qty: 1, cond: 'excellent' },
    { key: 'l24105', name: 'RF 24-105mm f/4 L', cat: 'lens', model: 'Canon RF 24-105mm f/4 L', tag: 'LS-LNS-05', qty: 1, cond: 'needs_repair', notes: 'Zoom ring is sticking - sent for service.' },
    { key: 'drone', name: 'DJI Mavic 3 Pro Drone', cat: 'drone', model: 'DJI Mavic 3 Pro', tag: 'LS-DRN-01', qty: 1, cond: 'excellent', notes: 'Registered. Check venue permission before every flight.' },
    { key: 'gimbal', name: 'DJI RS 3 Pro Gimbal', cat: 'gimbal', model: 'DJI RS 3 Pro', tag: 'LS-GMB-01', qty: 1, cond: 'good' },
    { key: 'godox', name: 'Godox AD600 Pro Strobes', cat: 'lighting', model: 'Godox AD600 Pro', tag: null, qty: 2, cond: 'good' },
    { key: 'v1', name: 'Godox V1 Round-Head Flash', cat: 'flash', model: 'Godox V1', tag: null, qty: 4, cond: 'good' },
    { key: 'mic', name: 'Rode Wireless GO II', cat: 'microphone', model: 'Rode Wireless GO II', tag: null, qty: 2, cond: 'excellent' },
    { key: 'tripod', name: 'Manfrotto 055 Tripod', cat: 'tripod', model: 'Manfrotto 055', tag: null, qty: 3, cond: 'good' },
    { key: 'nikon', name: 'Nikon D750 (retired)', cat: 'still_camera', model: 'Nikon D750', tag: 'LS-CAM-00', qty: 1, cond: 'out_of_service', notes: 'Retired - kept for spare parts.', active: false },
  ]
  const equipment: Equipment[] = gearDefs.map((d, i) => ({
    id: seedId(K.gear, i + 1), studio_id: DEMO_STUDIO_ID, name: d.name, category: d.cat, brand_model: d.model, asset_tag: d.tag, quantity_owned: d.qty,
    condition: d.cond, notes: d.notes ?? null, is_active: d.active ?? true, created_at: when(-280 + i, '10:00'),
  }))
  const gear = Object.fromEntries(gearDefs.map((d, i) => [d.key, equipment[i]!])) as Record<GearKey, Equipment>

  // -------------------------------------------------------------- venues
  const V = {
    seabreeze: ['Seabreeze Banquets', 'Juhu Tara Road, Mumbai'] as [string, string],
    orchid: ['Orchid Lawns', 'Khandala Ghat Road, Lonavala'] as [string, string],
    mirage: ['Mirage Convention Centre', 'Andheri East, Mumbai'] as [string, string],
    lotus: ['Lotus Garden Resort', 'Mandwa Beach Road, Alibaug'] as [string, string],
    studioA: ['Lumen Studio - Studio A', '14 Harbour View Road, Mumbai'] as [string, string],
    aurora: ['Aurora Rooftop', 'Lower Parel, Mumbai'] as [string, string],
    harbour: ['Harbourview Hall', 'Colaba Causeway, Mumbai'] as [string, string],
    marigold: ['Marigold House', 'Koregaon Park, Pune'] as [string, string],
    skyline: ['Skyline Terrace', 'Hiranandani Gardens, Powai'] as [string, string],
    tech: ['Northwind Labs Campus', 'Tech Park, Airoli, Navi Mumbai'] as [string, string],
    khanna: ['Khanna & Co. Head Office', '5th Floor, Lower Parel, Mumbai'] as [string, string],
    hilltop: ['Hilltop Point', 'Tamhini Ghat, near Pune'] as [string, string],
  }

  // ------------------------------------------------------------ projects
  const T = (...t: [EmpKey, AssignmentRole][]) => t
  const specs: ProjectSpec[] = [
    {
      name: 'Nambiar Wedding', client: 'priya', type: 'wedding', booking: 'confirmed', stage: 'delivered', createdDay: -110, confirmedDay: -104, agreed: 285000, dueDay: -48,
      editor: 'naina', editDueDay: -30, deliveryDueDay: -18, approvedDay: -57, editedDay: -29, outDay: -22, deliveredDay: -20,
      description: 'Two-day Kerala-style wedding with a Mehendi evening and an evening reception.',
      internalNotes: 'Album design approved by the bride. Gallery password shared on WhatsApp.',
      delivery: { method: 'online_gallery', link: 'https://gallery.lumenstudio.example/nambiar-wedding', notes: 'Full gallery plus the highlight film. Album delivered separately.' },
      payments: [[-104, 100000, 'upi', { adv: true, ref: 'UPI-48201' }], [-75, 100000, 'bank_transfer', { ref: 'NEFT-77120' }], [-48, 85000, 'upi', { ref: 'UPI-50876' }]],
      sessions: [
        { title: 'Mehendi evening', day: -62, from: '16:00', to: '20:00', venue: V.seabreeze, type: 'other', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['l35']] },
        { title: 'Wedding ceremony', day: -61, from: '07:30', to: '14:30', venue: V.seabreeze, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['a7iv2'], ['l2470'], ['l70200'], ['gimbal']] },
        { title: 'Reception', day: -61, from: '19:00', to: '23:30', venue: V.seabreeze, type: 'reception', team: T(['rohan', 'lead_photographer'], ['dev', 'videographer']), gear: [['a7iv2'], ['v1', 2]] },
      ],
    },
    {
      name: 'Tandon Maternity Shoot', client: 'harsh', type: 'maternity', booking: 'confirmed', stage: 'delivered', createdDay: -70, confirmedDay: -65, agreed: 28000, dueDay: -48,
      editor: 'naina', editDueDay: -40, deliveryDueDay: -28, approvedDay: -47, editedDay: -38, outDay: -33, deliveredDay: -30,
      description: 'Studio maternity portraits, soft natural-light look, two outfit changes.',
      delivery: { method: 'download_link', link: 'https://gallery.lumenstudio.example/tandon-maternity', notes: '40 edited images. Client asked for two extra prints.' },
      paymentNotes: 'Client paid a little extra for the additional prints - kept as credit for a future shoot.',
      payments: [[-65, 10000, 'upi', { adv: true }], [-48, 18000, 'cash'], [-30, 1500, 'upi', { note: 'Extra prints (paid in advance for a future shoot)' }]],
      sessions: [{ title: 'Maternity portraits', day: -48, from: '10:00', to: '13:00', venue: V.studioA, type: 'maternity', team: T(['meera', 'lead_photographer'], ['kabir', 'assistant']), gear: [['r5'], ['l85'], ['godox']] }],
    },
    {
      name: 'Fernandes Birthday Bash', client: 'zoya', type: 'birthday', booking: 'confirmed', stage: 'delivered', createdDay: -55, confirmedDay: -50, agreed: 45000, dueDay: -33,
      editor: 'naina', editDueDay: -22, deliveryDueDay: -15, approvedDay: -31, editedDay: -20, outDay: -16, deliveredDay: -15,
      delivery: { method: 'in_person', notes: 'Pen drive handed over at the client\'s home with a printed contact sheet.' },
      payments: [[-50, 15000, 'upi', { adv: true }], [-33, 30000, 'upi']],
      sessions: [{ title: 'Birthday celebration', day: -33, from: '18:00', to: '22:00', venue: V.skyline, type: 'birthday', team: T(['rohan', 'lead_photographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['l35'], ['v1']] }],
    },
    {
      name: 'Brightleaf Annual Gala', client: 'brightleaf', type: 'corporate', booking: 'confirmed', stage: 'delivered', createdDay: -60, confirmedDay: -55, agreed: 160000, dueDay: -5,
      editor: 'naina', editDueDay: -17, deliveryDueDay: -9, approvedDay: -24, editedDay: -16, outDay: -10, deliveredDay: -8,
      description: 'Annual awards evening for 300 guests. Coverage of arrivals, stage, awards and the networking dinner.',
      internalNotes: 'Final instalment is overdue - Brightleaf accounts promised it by month end.',
      delivery: { method: 'download_link', link: 'https://gallery.lumenstudio.example/brightleaf-gala', notes: 'Highlights film plus 600 images. Link valid for 90 days.' },
      payments: [[-55, 80000, 'bank_transfer', { adv: true, ref: 'NEFT-61044', by: 'Tara Bhatt' }], [-20, 40000, 'bank_transfer', { ref: 'NEFT-62190', by: 'Tara Bhatt' }]],
      sessions: [{ title: 'Gala evening', day: -26, from: '19:00', to: '23:30', venue: V.harbour, type: 'corporate', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['a7iv2'], ['fx3'], ['l2470'], ['mic']] }],
    },
    {
      name: 'Chopra Pre-wedding', client: 'saanvi', type: 'pre_wedding', booking: 'confirmed', stage: 'out_for_delivery', createdDay: -40, confirmedDay: -35, agreed: 95000, dueDay: 3,
      editor: 'naina', editDueDay: -5, deliveryDueDay: 1, approvedDay: -14, editedDay: -4, outDay: -2,
      description: 'Sunrise and golden-hour couple shoot at two locations, with a short drone sequence.',
      delivery: { method: 'online_gallery', link: 'https://gallery.lumenstudio.example/chopra-prewedding', notes: 'Gallery is ready; waiting on the final instalment before it is shared.', draftOnly: true },
      payments: [[-35, 40000, 'upi', { adv: true }], [-20, 20000, 'upi']],
      sessions: [
        { title: 'Sunrise shoot', day: -18, from: '05:30', to: '09:30', venue: V.hilltop, type: 'pre_wedding', team: T(['olivia', 'lead_photographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['l85'], ['l35']] },
        { title: 'Golden hour', day: -17, from: '16:00', to: '19:00', venue: V.lotus, type: 'pre_wedding', team: T(['olivia', 'lead_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['drone'], ['gimbal']] },
      ],
    },
    {
      name: 'Menon Engagement', client: 'rahul', type: 'engagement', booking: 'confirmed', stage: 'editing', createdDay: -30, confirmedDay: -26, agreed: 70000, dueDay: 10,
      editor: 'naina', editDueDay: -1, deliveryDueDay: 6, approvedDay: -9,
      description: 'Ring ceremony with 120 guests. Couple would like a short teaser reel as well.',
      internalNotes: 'Editing is behind - the client asked for extra family portraits to be retouched.',
      payments: [[-26, 35000, 'upi', { adv: true }]],
      sessions: [{ title: 'Engagement ceremony', day: -12, from: '17:00', to: '21:00', venue: V.skyline, type: 'engagement', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['a7iv2'], ['l2470']] }],
    },
    {
      name: 'Rahman Wedding', client: 'rahman', type: 'wedding', booking: 'confirmed', stage: 'editing', createdDay: -95, confirmedDay: -90, agreed: 420000, dueDay: 8,
      editor: 'naina', editDueDay: 7, deliveryDueDay: 14, approvedDay: -5,
      description: 'Sangeet, wedding and reception across two days. Highlight film and a 60-page album are included.',
      internalNotes: 'Album layout starts after the client picks favourites. Remaining balance due on delivery.',
      payments: [[-90, 120000, 'bank_transfer', { adv: true, ref: 'NEFT-33901' }], [-45, 100000, 'bank_transfer', { ref: 'NEFT-35520' }], [-10, 80000, 'upi', { ref: 'UPI-91820' }]],
      sessions: [
        { title: 'Sangeet night', day: -9, from: '19:00', to: '23:30', venue: V.mirage, type: 'other', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['v1', 2]] },
        { title: 'Wedding ceremony', day: -8, from: '09:00', to: '15:00', venue: V.mirage, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['a7iv2'], ['l2470'], ['l70200']] },
        { title: 'Reception', day: -8, from: '19:30', to: '23:55', venue: V.mirage, type: 'reception', team: T(['rohan', 'lead_photographer'], ['dev', 'videographer']), gear: [['a7iv2'], ['v1', 2]] },
      ],
    },
    {
      name: 'Northwind Labs Offsite', client: 'northwind', type: 'corporate', booking: 'confirmed', stage: 'editing', createdDay: -25, confirmedDay: -22, agreed: 85000, dueDay: -5,
      editor: 'naina', editDueDay: 0, deliveryDueDay: -1, approvedDay: -4, editedDay: -1,
      description: 'Full-day team offsite: sessions, group portraits and candid coverage for the company blog.',
      internalNotes: 'Editing is finished - waiting for Olivia to mark it out for delivery. Delivery date has slipped.',
      payments: [[-22, 40000, 'bank_transfer', { adv: true, by: 'Tara Bhatt' }], [-5, 45000, 'bank_transfer', { by: 'Tara Bhatt' }]],
      sessions: [{ title: 'Team offsite coverage', day: -5, from: '09:00', to: '17:00', venue: V.tech, type: 'corporate', team: T(['meera', 'lead_photographer'], ['dev', 'videographer']), gear: [['r5'], ['l2470'], ['mic']] }],
    },
    {
      name: 'Pillai Wedding', client: 'meghna', type: 'wedding', booking: 'confirmed', stage: 'awaiting_approval', createdDay: -70, confirmedDay: -64, agreed: 350000, dueDay: 5,
      editor: 'naina', editDueDay: 12, deliveryDueDay: 24,
      description: 'Haldi and wedding ceremony in the family home garden, 200 guests.',
      payments: [[-64, 150000, 'bank_transfer', { adv: true, ref: 'NEFT-40018' }], [-1, 100000, 'upi', { ref: 'UPI-97711' }]],
      sessions: [
        { title: 'Haldi', day: -3, from: '09:00', to: '12:00', venue: V.orchid, type: 'other', team: T(['meera', 'lead_photographer'], ['dev', 'videographer']), gear: [['a7iv2'], ['l35']] },
        { title: 'Wedding ceremony', day: -2, from: '07:00', to: '14:00', venue: V.orchid, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['a7iv2'], ['l2470'], ['l70200'], ['drone']] },
      ],
    },
    {
      name: 'Deshmukh Wedding', client: 'aanya', type: 'wedding', booking: 'confirmed', stage: 'production', createdDay: -45, confirmedDay: -40, agreed: 480000, dueDay: 3,
      editor: 'naina', editDueDay: 18, deliveryDueDay: 30,
      description: 'Three-day Maharashtrian wedding: Mehendi, Haldi, the ceremony and the reception. A documentary style with a short teaser film.',
      internalNotes: 'Bride\'s mother wants family portraits straight after the ceremony. Venue has strict drone rules - check with the manager.',
      payments: [[-40, 150000, 'bank_transfer', { adv: true, ref: 'NEFT-52210' }], [-20, 100000, 'upi', { ref: 'UPI-83320' }]],
      sessions: [
        { title: 'Mehendi', day: -1, from: '16:00', to: '20:00', venue: V.seabreeze, type: 'other', team: T(['meera', 'lead_photographer'], ['rohan', 'second_photographer'], ['kabir', 'assistant']), gear: [['a7iv2'], ['l35']] },
        { title: 'Haldi', day: 0, from: '09:00', to: '12:00', venue: V.seabreeze, type: 'other', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer']), gear: [['a7iv1'], ['l85']] },
        { title: 'Wedding ceremony', day: 0, from: '17:00', to: '23:30', venue: V.seabreeze, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['a7iv2'], ['l2470'], ['l70200'], ['v1', 2], ['gimbal']] },
        { title: 'Reception', day: 1, from: '19:00', to: '23:30', venue: V.seabreeze, type: 'reception', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['l2470'], ['godox']] },
      ],
    },
    {
      name: 'Khanna Corporate Portraits', client: 'arjun', type: 'corporate', booking: 'confirmed', stage: 'upcoming', createdDay: -12, confirmedDay: -10, agreed: 36000, dueDay: 6,
      editor: 'naina', editDueDay: 5, deliveryDueDay: 9,
      description: 'Headshots for the leadership team and a few lifestyle shots of the office.',
      payments: [[-10, 12000, 'upi', { adv: true }]],
      sessions: [{ title: 'Executive headshots', day: 0, from: '12:30', to: '16:00', venue: V.khanna, type: 'corporate', team: T(['aditya', 'lead_photographer'], ['kabir', 'assistant']), gear: [['r5'], ['l2470'], ['godox'], ['tripod', 2]] }],
    },
    {
      name: 'Chopra Anniversary Dinner', client: 'saanvi', type: 'other', booking: 'confirmed', stage: 'upcoming', createdDay: -6, confirmedDay: -5, agreed: 40000, dueDay: 9,
      description: 'A small candlelit anniversary dinner for the couple\'s families.',
      payments: [[-5, 10000, 'upi', { adv: true }]],
      sessions: [{ title: 'Anniversary dinner', day: 2, from: '19:00', to: '22:00', venue: V.aurora, type: 'other' }],
    },
    {
      name: 'Bhargava Wedding', client: 'tanvi', type: 'wedding', booking: 'confirmed', stage: 'upcoming', createdDay: -14, confirmedDay: -12, agreed: 395000, dueDay: 20,
      editor: 'naina', editDueDay: 32, deliveryDueDay: 45,
      description: 'Destination wedding weekend in Lonavala with a sundowner Mehendi and an evening reception.',
      internalNotes: 'Drone shots planned over the lawns during the ceremony - permission requested from the resort.',
      payments: [[-12, 150000, 'bank_transfer', { adv: true, ref: 'NEFT-71002' }]],
      sessions: [
        { title: 'Mehendi', day: 5, from: '15:00', to: '19:00', venue: V.orchid, type: 'other', team: T(['meera', 'lead_photographer'], ['dev', 'videographer']), gear: [['a7iv2'], ['l35']] },
        { title: 'Wedding ceremony', day: 6, from: '08:00', to: '14:00', venue: V.orchid, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer'], ['kabir', 'assistant']), gear: [['a7iv1'], ['a7iv2'], ['l2470'], ['l85'], ['drone'], ['v1', 2]] },
        { title: 'Reception', day: 6, from: '19:00', to: '23:00', venue: V.orchid, type: 'reception', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer']), gear: [['a7iv1'], ['godox']] },
      ],
    },
    {
      name: 'Northwind Product Launch', client: 'northwind', type: 'corporate', booking: 'confirmed', stage: 'upcoming', createdDay: -9, confirmedDay: -8, agreed: 90000, dueDay: 12,
      description: 'Stage coverage and a short social video for the new product launch.',
      payments: [[-8, 30000, 'bank_transfer', { adv: true, by: 'Tara Bhatt' }]],
      sessions: [{ title: 'Launch event', day: 6, from: '10:00', to: '13:00', venue: V.tech, type: 'corporate', team: T(['aditya', 'lead_photographer'], ['dev', 'videographer'], ['samar', 'videographer']), gear: [['fx3'], ['gimbal'], ['drone'], ['mic', 2]] }],
    },
    {
      name: 'Fernandes Engagement', client: 'zoya', type: 'engagement', booking: 'confirmed', stage: 'upcoming', createdDay: -8, confirmedDay: -6, agreed: 65000, dueDay: 15,
      payments: [[-6, 20000, 'upi', { adv: true }]],
      sessions: [{ title: 'Engagement party', day: 9, from: '17:00', to: '21:00', venue: V.marigold, type: 'engagement', team: T(['rohan', 'lead_photographer'], ['meera', 'second_photographer']), gear: [['a7iv1'], ['l2470'], ['v1']] }],
    },
    {
      name: 'Brightleaf Spring Showcase', client: 'brightleaf', type: 'corporate', booking: 'confirmed', stage: 'upcoming', createdDay: -5, confirmedDay: -3, agreed: 120000, dueDay: 22,
      payments: [[-3, 40000, 'bank_transfer', { adv: true, by: 'Tara Bhatt' }]],
      sessions: [{ title: 'Showcase day', day: 16, from: '10:00', to: '18:00', venue: V.harbour, type: 'corporate', team: T(['olivia', 'lead_photographer'], ['meera', 'second_photographer'], ['dev', 'videographer']), gear: [['a7iv1'], ['a7iv2'], ['fx3'], ['mic']] }],
    },
    {
      name: 'Menon Wedding', client: 'rahul', type: 'wedding', booking: 'confirmed', stage: 'upcoming', createdDay: -4, confirmedDay: -2, agreed: 450000, dueDay: 30,
      description: 'Two-day wedding. The reception venue is still being finalised by the family.',
      payments: [[-2, 100000, 'bank_transfer', { adv: true, ref: 'NEFT-80331' }]],
      sessions: [
        { title: 'Wedding ceremony', day: 38, from: '08:30', to: '14:00', venue: V.lotus, type: 'wedding', team: T(['olivia', 'lead_photographer'], ['rohan', 'second_photographer']), gear: [['a7iv1'], ['l2470']] },
        { title: 'Reception', day: 38, from: '19:30', to: '23:30', type: 'reception' },
      ],
    },
    {
      name: 'Kulkarni Pre-wedding', client: 'ishaan', type: 'pre_wedding', booking: 'inquiry', stage: 'upcoming', createdDay: -3, agreed: 85000,
      description: 'Enquiry for a sunrise pre-wedding shoot near Pune. Waiting for the couple to pick a date.',
      sessions: [{ title: 'Sunrise shoot', day: 25, from: '06:00', to: '09:00', venue: V.hilltop, type: 'pre_wedding' }],
    },
    {
      name: 'Tandon Family Birthday', client: 'harsh', type: 'birthday', booking: 'inquiry', stage: 'upcoming', createdDay: -2, agreed: 30000,
      sessions: [{ title: 'Birthday party', day: 41, from: '17:00', to: '20:00', venue: V.skyline, type: 'birthday' }],
    },
    {
      name: 'Menon Anniversary Portraits', client: 'rahul', type: 'other', booking: 'cancelled', stage: 'upcoming', createdDay: -30, confirmedDay: -25, cancelDay: -9, agreed: 30000,
      cancelReason: 'Client postponed the celebration to next year.',
      payments: [[-25, 5000, 'upi', { adv: true, void: 'Refunded to the client after the cancellation.' }]],
      sessions: [{ title: 'Anniversary portraits', day: 20, from: '16:00', to: '19:00', venue: V.studioA, type: 'other' }],
    },
    {
      name: 'Kapoor Engagement', client: 'kavya', type: 'engagement', booking: 'confirmed', stage: 'delivered', createdDay: -210, confirmedDay: -205, agreed: 60000, archivedDay: -100,
      approvedDay: -150, editedDay: -140, outDay: -132, deliveredDay: -128, editor: 'naina',
      description: 'Intimate engagement party. Archived after the client relocated abroad.',
      delivery: { method: 'download_link', link: 'https://gallery.lumenstudio.example/kapoor-engagement' },
      payments: [[-205, 20000, 'upi', { adv: true }], [-170, 40000, 'bank_transfer']],
      sessions: [{ title: 'Engagement party', day: -160, from: '18:00', to: '22:00', venue: V.marigold, type: 'engagement', team: T(['rohan', 'lead_photographer'], ['isha', 'assistant']), gear: [['a7iv1'], ['l35']] }],
    },
  ]

  const projects: Project[] = []
  const finances: ProjectFinance[] = []
  const events: ProjectEvent[] = []
  const assignments: EventAssignment[] = []
  const eventEquipment: EventEquipment[] = []
  const payments: Payment[] = []
  const tasks: ProductionTask[] = []
  const deliveries: ProjectDelivery[] = []
  const reminders: EventReminder[] = []
  const activity: ActivityLog[] = []
  const counters = { event: 0, assign: 0, eqRow: 0, payment: 0, task: 0, activity: 0, remind: 0 }
  const log = (projectId: string | null, entity: string, action: string, summary: string, createdAt: string, opts: { actor?: string | null; financial?: boolean; meta?: Record<string, unknown> } = {}) => {
    activity.push({
      id: seedId(K.activity, ++counters.activity), project_id: projectId, entity_type: entity, action, summary, category: opts.financial ? 'financial' : 'general',
      actor_name: opts.actor === undefined ? DEMO_USER_NAME : opts.actor, metadata: opts.meta ?? {}, created_at: createdAt,
    })
  }
  const leadMs = 24 * 3_600_000 // reminder lead time (studio setting: 24 hours)

  specs.forEach((s, pi) => {
    const id = seedId(K.project, pi + 1)
    const rank = PRODUCTION_STAGES.indexOf(s.stage)
    const confirmed = s.booking === 'confirmed'
    const sessions = s.sessions.map((x) => ({ ...x, startsAt: when(x.day, x.from), endsAt: when(x.day, x.to) }))
    const firstStart = sessions.map((x) => x.startsAt).sort()[0]!
    const lastEnd = sessions.map((x) => x.endsAt).sort().at(-1)!
    const createdAt = when(s.createdDay, '10:00')
    const approvedAt = confirmed && rank >= 3 ? when(s.approvedDay ?? s.createdDay, '12:00') : null
    const editedAt = confirmed && s.editedDay !== undefined ? when(s.editedDay, '17:30') : null
    const outAt = confirmed && rank >= 4 ? when(s.outDay ?? s.editedDay ?? 0, '11:00') : null
    const deliveredAt = confirmed && rank >= 5 ? when(s.deliveredDay ?? 0, '15:00') : null
    const editorId = s.editor ? emp[s.editor].id : null

    const project: Project = {
      id, studio_id: DEMO_STUDIO_ID, project_code: `FP-${String(pi + 1).padStart(4, '0')}`, client_id: client[s.client].id, name: s.name, event_type: s.type,
      description: s.description ?? null, internal_notes: s.internalNotes ?? null, booking_status: s.booking, production_stage: s.stage, editor_id: editorId,
      editing_due_date: s.editDueDay !== undefined ? dateOnly(s.editDueDay) : null, delivery_due_date: s.deliveryDueDay !== undefined ? dateOnly(s.deliveryDueDay) : null,
      confirmed_at: confirmed && s.confirmedDay !== undefined ? when(s.confirmedDay, '11:15') : null,
      cancelled_at: s.booking === 'cancelled' ? when(s.cancelDay ?? -1, '14:00') : null, cancel_reason: s.cancelReason ?? null,
      production_started_at: confirmed && rank >= 1 ? firstStart : null, shoot_completed_at: confirmed && rank >= 2 ? lastEnd : null,
      editing_started_at: approvedAt, editing_completed_at: editedAt, ready_for_delivery_at: outAt, delivered_at: deliveredAt,
      client_approved_at: approvedAt, client_approved_by_name: approvedAt ? DEMO_USER_NAME : null,
      client_approval_note: approvedAt ? 'Approved by the client over a call.' : null,
      production_start_applied_at: confirmed && rank >= 1 ? firstStart : null, production_end_applied_at: confirmed && rank >= 2 ? lastEnd : null,
      archived_at: s.archivedDay !== undefined ? when(s.archivedDay, '12:00') : null, created_at: createdAt,
      updated_at: [createdAt, outAt, deliveredAt, editedAt, approvedAt].filter((x): x is string => !!x).sort().at(-1)!,
    }
    projects.push(project)
    finances.push({ project_id: id, agreed_amount: s.agreed, payment_due_date: s.dueDay !== undefined ? dateOnly(s.dueDay) : null, payment_notes: s.paymentNotes ?? null })

    log(id, 'project', 'project_created', `Event created: ${s.name}`, createdAt, { actor: pi % 3 === 0 ? 'Tara Bhatt' : DEMO_USER_NAME })
    if (project.confirmed_at) log(id, 'project', 'booking_confirmed', 'Booking confirmed', project.confirmed_at, { meta: { status: 'confirmed' } })

    // sessions, team, equipment, reminders
    sessions.forEach((x, si) => {
      const evId = seedId(K.event, ++counters.event)
      events.push({
        id: evId, studio_id: DEMO_STUDIO_ID, project_id: id, title: x.title, event_type: x.type ?? s.type, starts_at: x.startsAt, ends_at: x.endsAt,
        venue_name: x.venue?.[0] ?? null, venue_address: x.venue?.[1] ?? null, map_url: null, notes: x.notes ?? null, sort_order: si, cancelled_at: null,
      })
      for (const [key, role] of x.team ?? []) {
        assignments.push({ id: seedId(K.assign, ++counters.assign), event_id: evId, employee_id: emp[key].id, role, notes: null })
        if (s.createdDay > -40 || si === 0) log(id, 'assignment', 'assignment_added', `${emp[key].full_name} assigned to ${x.title}`, when(s.createdDay, '12:30'), { actor: 'Tara Bhatt' })
        if (confirmed && !s.archivedDay && x.startsAt > when(-3, '00:00')) {
          const remindAt = new Date(new Date(x.startsAt).getTime() - leadMs).toISOString()
          reminders.push({
            id: seedId(K.remind, ++counters.remind), event_id: evId, employee_id: emp[key].id, role, event_starts_at: x.startsAt, remind_at: remindAt,
            status: remindAt <= nowIso ? 'sent' : 'scheduled', last_error: null,
          })
        }
      }
      for (const [key, qty] of x.gear ?? []) {
        eventEquipment.push({ id: seedId(K.eqRow, ++counters.eqRow), event_id: evId, equipment_id: gear[key].id, custom_name: null, quantity: qty ?? 1, notes: null })
      }
      if (x.customGear) eventEquipment.push({ id: seedId(K.eqRow, ++counters.eqRow), event_id: evId, equipment_id: null, custom_name: x.customGear, quantity: 1, notes: 'Rental' })
    })

    // payments
    for (const [day, amount, method, o] of s.payments ?? []) {
      const pid = seedId(K.payment, ++counters.payment)
      const createdAtP = when(day, '15:30')
      payments.push({
        id: pid, project_id: id, amount, paid_on: dateOnly(day), method, reference: o?.ref ?? null, notes: o?.note ?? null, is_advance: !!o?.adv,
        status: o?.void ? 'void' : 'valid', voided_at: o?.void ? when(s.cancelDay ?? day + 1, '16:00') : null, void_reason: o?.void ?? null,
        recorded_by_name: o?.by ?? DEMO_USER_NAME, created_at: createdAtP,
      })
      log(id, 'payment', 'payment_recorded', o?.adv ? 'Advance payment recorded' : 'Payment recorded', createdAtP, { financial: true, actor: o?.by ?? DEMO_USER_NAME, meta: { amount, method } })
      if (o?.void) log(id, 'payment', 'payment_voided', 'Payment voided', when(s.cancelDay ?? day + 1, '16:00'), { financial: true, meta: { amount } })
    }

    // lifecycle trail
    if (confirmed && rank >= 1) log(id, 'project', 'workflow_start_production', 'Production started automatically at the scheduled start', firstStart, { actor: null, meta: { stage: 'production', automatic: true } })
    if (confirmed && rank >= 2) log(id, 'project', 'workflow_complete_shoot', 'Production completed automatically at the scheduled end - waiting for client approval', lastEnd, { actor: null, meta: { stage: 'awaiting_approval', automatic: true } })
    if (approvedAt) log(id, 'project', 'workflow_approve_client', 'Client approval recorded - editing started', approvedAt, { meta: { stage: 'editing' } })
    if (editedAt) log(id, 'project', 'workflow_complete_editing', 'Editing marked completed', editedAt, { actor: 'Naina Rao' })
    if (outAt) log(id, 'project', 'workflow_mark_out_for_delivery', 'Marked out for delivery', outAt, { meta: { stage: 'out_for_delivery' } })
    if (deliveredAt) log(id, 'project', 'workflow_mark_delivered', 'Event delivered', deliveredAt, { meta: { stage: 'delivered' } })
    if (s.booking === 'cancelled') log(id, 'project', 'booking_cancelled', 'Booking cancelled', project.cancelled_at!, { meta: { status: 'cancelled', reason: s.cancelReason } })
    if (project.archived_at) log(id, 'project', 'project_archived', 'Event archived', project.archived_at)

    // delivery details
    if (s.delivery) {
      deliveries.push({
        project_id: id, method: s.delivery.method, delivered_on: s.delivery.draftOnly ? null : dateOnly(s.deliveredDay ?? 0), link_url: s.delivery.link ?? null,
        notes: s.delivery.notes ?? null, confirmed_at: s.delivery.draftOnly ? null : deliveredAt,
      })
      log(id, 'delivery', 'delivery_updated', 'Delivery details updated', clampPast(when((s.deliveredDay ?? s.outDay ?? 0) - 1, '16:00')))
    }

    // checklist: which steps are done depends on how far the event has got
    CHECKLIST.forEach((item, ti) => {
      const stageDone =
        confirmed &&
        (rank >= 5 ||
          (item.phase === 'preparation' && (rank >= 1 || (rank === 0 && item.title === 'Team confirmed' && sessions[0]!.day <= 7 && (sessions[0]!.team?.length ?? 0) > 0))) ||
          (item.phase === 'shoot' && rank >= 2) ||
          (item.phase === 'post' && rank >= 3) ||
          (item.title === 'Editing completed' && !!editedAt) ||
          (item.title === 'Final files exported' && rank >= 4) ||
          (item.title === 'Client review completed' && rank >= 4))
      // preparation is done a few days after booking (and before the first session), never "just now"
      const prepAt = [new Date(new Date(firstStart).getTime() - 36 * 3_600_000).toISOString(), when(s.createdDay + 3, '15:00')].sort()[0]!
      // one task is ticked this morning so the activity feed reads like a working day
      const thisMorning = s.name === 'Deshmukh Wedding' && item.title === 'Equipment prepared'
      const doneAtRaw =
        thisMorning ? when(0, '07:40')
        : item.phase === 'preparation' ? prepAt
        : item.phase === 'shoot' ? new Date(new Date(lastEnd).getTime() + 3 * 3_600_000).toISOString()
        : item.phase === 'post' ? new Date(new Date(lastEnd).getTime() + 30 * 3_600_000).toISOString()
        : item.title === 'Editing completed' ? (editedAt ?? nowIso)
        : (outAt ?? deliveredAt ?? nowIso)
      const doneAt = clampPast(doneAtRaw)
      const by = thisMorning ? 'Kabir Sethi' : item.phase === 'preparation' ? 'Tara Bhatt' : item.phase === 'shoot' || item.phase === 'post' ? 'Rohan Iyer' : item.phase === 'editing' ? 'Naina Rao' : DEMO_USER_NAME
      const taskId = seedId(K.task, ++counters.task)
      tasks.push({
        id: taskId, project_id: id, title: item.title, phase: item.phase, sort_order: ti * 10, assignee_id: item.phase === 'editing' ? editorId : null,
        is_done: stageDone, done_at: stageDone ? doneAt : null, done_by_name: stageDone ? by : null,
      })
      if (stageDone && rank < 5 && !s.archivedDay) log(id, 'task', 'task_completed', `Completed: ${item.title}`, doneAt, { actor: by })
    })
  })

  const pByName = (n: string) => projects.find((p) => p.name === n)!.id
  log(null, 'client', 'client_created', 'Client added: Ishaan Kulkarni', when(-3, '11:00'), { actor: 'Tara Bhatt' })

  // ------------------------------------------------------ notifications
  const n = (type: NotificationType, title: string, body: string, projectName: string | null, offset: number, hhmm: string, unread: boolean, link?: string): AppNotification => ({
    id: seedId(K.notif, 0), type, title, body, link: link ?? (projectName ? `/events/${pByName(projectName)}` : null), project_id: projectName ? pByName(projectName) : null,
    event_id: null, read_at: unread ? null : clampPast(when(offset, '23:00')), created_at: clampPast(when(offset, hhmm)), recipient_employee_id: DEMO_OWNER_ID, show_in_app: true,
  })
  const notifications = [
    n('event_reminder', 'Today: Deshmukh Wedding', 'The wedding ceremony starts at 5:00 PM at Seabreeze Banquets. The team is confirmed.', 'Deshmukh Wedding', 0, '07:00', true),
    n('editing_overdue', 'Editing overdue: Menon Engagement', 'Editing was due yesterday. Naina Rao is working on it.', 'Menon Engagement', 0, '08:00', true),
    n('delivery_overdue', 'Delivery overdue: Northwind Labs Offsite', 'Editing is finished but the event has not been marked out for delivery.', 'Northwind Labs Offsite', 0, '08:05', true),
    n('payment_due', 'Payment overdue: Brightleaf Annual Gala', 'The final instalment of ₹40,000 was due 5 days ago.', 'Brightleaf Annual Gala', -1, '09:30', true),
    n('production_deadline', 'Delivery due tomorrow: Chopra Pre-wedding', 'The gallery is ready. The final instalment is still pending.', 'Chopra Pre-wedding', 0, '08:10', false),
    n('event_reminder', 'Tomorrow: Khanna Corporate Portraits', 'Executive headshots start at 12:30 PM at the client\'s office.', 'Khanna Corporate Portraits', -1, '11:00', false),
    n('new_assignment', 'You are on Bhargava Wedding', 'Lead photographer for the wedding ceremony in Lonavala.', 'Bhargava Wedding', -2, '12:30', false),
    n('assignment_changed', 'Team updated: Northwind Product Launch', 'Samar Joshi was added as the drone pilot.', 'Northwind Product Launch', -3, '15:15', false),
    n('event_rescheduled', 'Session updated: Fernandes Engagement', 'The engagement party now starts at 5:00 PM.', 'Fernandes Engagement', -4, '10:20', false),
    n('event_cancelled', 'Event cancelled: Menon Anniversary Portraits', 'The client postponed the celebration. The advance was refunded.', 'Menon Anniversary Portraits', -9, '14:05', false),
    n('payment_due', 'Payment due soon: Pillai Wedding', 'A balance of ₹1,00,000 is due in 5 days.', 'Pillai Wedding', -1, '16:20', false),
    n('event_reminder', 'Reminder: Pillai Wedding', 'The wedding ceremony starts tomorrow at 7:00 AM.', 'Pillai Wedding', -3, '07:00', false),
  ].map((x, i) => ({ ...x, id: seedId(K.notif, i + 1) }))

  const mail = (i: number, status: NotificationDelivery['status'], offset: number, hhmm: string, extra: Partial<NotificationDelivery> = {}): NotificationDelivery => ({
    id: seedId(K.mail, i + 1), notification_id: notifications[i % notifications.length]!.id, channel: 'email', to_address: DEMO_USER_EMAIL, status, attempts: status === 'pending' ? 0 : 1,
    max_attempts: 3, last_error: null, sent_at: status === 'sent' ? clampPast(when(offset, hhmm)) : null, created_at: clampPast(when(offset, hhmm)), ...extra,
  })
  const emailDeliveries: NotificationDelivery[] = [
    mail(0, 'sent', 0, '07:00'),
    mail(1, 'sent', 0, '08:00'),
    mail(2, 'processing', 0, '08:05'),
    mail(3, 'failed', -1, '09:30', { attempts: 3, last_error: 'The mail server did not accept the message (demo data).' }),
    mail(4, 'pending', 0, '08:10'),
    mail(5, 'sent', -1, '11:00'),
    mail(6, 'skipped', -2, '12:30', { last_error: 'Skipped: email notifications are switched off for this category.' }),
    mail(9, 'sent', -9, '14:05'),
  ]

  return {
    studio: {
      id: DEMO_STUDIO_ID, name: 'Lumen Studio', logo_path: null, email: 'hello@lumenstudio.example', phone: '+91 55501 00000',
      address: '14 Harbour View Road', city: 'Mumbai', state: 'Maharashtra', timezone: 'Asia/Kolkata', currency: 'INR', onboarding_step: 4,
      onboarding_completed_at: when(-300, '12:00'), reminder_lead_hours: 24, default_checklist: CHECKLIST, created_at: when(-300, '09:00'),
    },
    profile: { id: DEMO_USER_ID, full_name: DEMO_USER_NAME, email: DEMO_USER_EMAIL, phone: emp.olivia.phone },
    employees, clients, projects, finances, events, assignments, equipment, eventEquipment, payments, tasks, deliveries, activity, notifications, emailDeliveries, reminders,
    prefs: { in_app_enabled: true, email_enabled: true, cat_reminders: true, cat_assignments: true, cat_schedule: true, cat_production: true, cat_payments: true },
    projectSeq: specs.length,
  }
}
