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

export interface NavItem {
  to: string
  label: string
  icon: string
  permission: Permission
  end?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: 'overview', permission: 'overview.view', end: true },
  { to: '/projects', label: 'Projects', icon: 'projects', permission: 'projects.view' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', permission: 'calendar.view' },
  { to: '/clients', label: 'Clients', icon: 'clients', permission: 'clients.view' },
  { to: '/team', label: 'Team', icon: 'team', permission: 'team.view' },
  { to: '/equipment', label: 'Equipment', icon: 'equipment', permission: 'equipment.view' },
  { to: '/payments', label: 'Payments', icon: 'payments', permission: 'finance.view' },
  { to: '/notifications', label: 'Notifications', icon: 'notifications', permission: 'notifications.view' },
  { to: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.view' },
  { to: '/settings', label: 'Studio Settings', icon: 'settings', permission: 'studio.manage' },
]

export function visibleNav(actor: Actor | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => can(actor, item.permission))
}
