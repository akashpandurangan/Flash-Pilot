import type { AccessRole, TaskPhase } from '@/types/entities'

/**
 * UI mirror of the database's authorization rules (RLS + RPC checks). It decides
 * what to *show*; the database decides what is *allowed*. Keep the two in step -
 * tests/db covers the SQL side, src/lib/permissions.test.ts the matrix below.
 */

export interface Actor {
  role: AccessRole
  canViewFinancials: boolean
}

export type Permission =
  | 'overview.view'
  | 'projects.view'
  | 'projects.manage'
  | 'calendar.view'
  | 'clients.view'
  | 'clients.manage'
  | 'team.view'
  | 'team.manage'
  | 'team.invite'
  | 'equipment.view'
  | 'equipment.manage'
  | 'finance.view'
  | 'finance.manage'
  | 'reports.view'
  | 'studio.manage'
  | 'notifications.view'
  | 'delivery.manage'

const isStaff = (a: Actor) => a.role === 'owner' || a.role === 'manager'
/** Owners always; managers only with the explicit financial permission. */
export const hasFinanceAccess = (a: Actor) => a.role === 'owner' || (a.role === 'manager' && a.canViewFinancials)

const RULES: Record<Permission, (a: Actor) => boolean> = {
  'overview.view': () => true,
  'projects.view': () => true, // scoped by RLS to assigned projects for crew
  'projects.manage': isStaff,
  'calendar.view': () => true,
  'clients.view': isStaff,
  'clients.manage': isStaff,
  'team.view': isStaff,
  'team.manage': isStaff,
  'team.invite': (a) => a.role === 'owner',
  'equipment.view': isStaff,
  'equipment.manage': isStaff,
  'finance.view': hasFinanceAccess,
  'finance.manage': (a) => isStaff(a) && hasFinanceAccess(a),
  'reports.view': isStaff,
  'studio.manage': (a) => a.role === 'owner',
  'notifications.view': () => true,
  'delivery.manage': isStaff,
}

export function can(actor: Actor | null | undefined, permission: Permission): boolean {
  return actor ? RULES[permission](actor) : false
}

/** Checklist phases each role may tick off (mirrors role_can_complete_phase). */
const PHASES_BY_ROLE: Record<AccessRole, TaskPhase[]> = {
  owner: ['preparation', 'shoot', 'post', 'editing', 'delivery'],
  manager: ['preparation', 'shoot', 'post', 'editing', 'delivery'],
  photographer: ['preparation', 'shoot'],
  editor: ['post', 'editing'],
}

export function canCompletePhase(role: AccessRole, phase: TaskPhase): boolean {
  return PHASES_BY_ROLE[role].includes(phase)
}

export type NavSection = 'main' | 'studio' | 'workspace'
export type NavBadgeKey = 'events' | 'production' | 'deliveries'

export interface NavItem {
  /** Stable identifier (also the icon key). */
  key: string
  to: string
  label: string
  section: NavSection
  permission: Permission
  end?: boolean
  badge?: NavBadgeKey
}

export const NAV_SECTION_LABELS: Record<NavSection, string> = { main: 'Main', studio: 'Studio management', workspace: 'Workspace' }

/**
 * Production and Deliveries are not separate pages: they are the Events list filtered to the
 * matching production stages, so they reuse the same data, permissions and routes.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', to: '/', label: 'Overview', section: 'main', permission: 'overview.view', end: true },
  { key: 'events', to: '/events', label: 'Events', section: 'main', permission: 'projects.view', badge: 'events' },
  { key: 'calendar', to: '/calendar', label: 'Calendar', section: 'main', permission: 'calendar.view' },
  { key: 'clients', to: '/clients', label: 'Clients', section: 'studio', permission: 'clients.view' },
  { key: 'team', to: '/team', label: 'Team', section: 'studio', permission: 'team.view' },
  { key: 'equipment', to: '/equipment', label: 'Equipment', section: 'studio', permission: 'equipment.view' },
  { key: 'payments', to: '/payments', label: 'Payments', section: 'studio', permission: 'finance.view' },
  { key: 'production', to: '/events?stage=production', label: 'Production', section: 'workspace', permission: 'projects.view', badge: 'production' },
  { key: 'deliveries', to: '/events?stage=ready_for_delivery', label: 'Deliveries', section: 'workspace', permission: 'projects.view', badge: 'deliveries' },
  { key: 'reports', to: '/reports', label: 'Reports', section: 'workspace', permission: 'reports.view' },
]

export function visibleNav(actor: Actor | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => can(actor, item.permission))
}

const PRODUCTION_STAGES_NAV = ['production', 'editing']
const DELIVERY_STAGES_NAV = ['ready_for_delivery', 'delivered']

/** Which sidebar entry is highlighted for the current URL (the stage filter decides between Events / Production / Deliveries). */
export function isNavActive(item: NavItem, pathname: string, search: string): boolean {
  if (item.key === 'overview') return pathname === '/'
  if (item.key === 'events' || item.key === 'production' || item.key === 'deliveries') {
    if (pathname !== '/events' && !pathname.startsWith('/events/')) return false
    const stage = pathname === '/events' ? new URLSearchParams(search).get('stage') ?? '' : ''
    const inProduction = PRODUCTION_STAGES_NAV.includes(stage)
    const inDeliveries = DELIVERY_STAGES_NAV.includes(stage)
    if (item.key === 'production') return inProduction
    if (item.key === 'deliveries') return inDeliveries
    return !inProduction && !inDeliveries
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}
