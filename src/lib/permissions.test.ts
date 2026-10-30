import { describe, expect, it } from 'vitest'
import { can, canCompletePhase, hasFinanceAccess, isNavActive, NAV_ITEMS, visibleNav, type Actor } from './permissions'

const owner: Actor = { role: 'owner', canViewFinancials: true }
const managerNoFin: Actor = { role: 'manager', canViewFinancials: false }
const managerFin: Actor = { role: 'manager', canViewFinancials: true }
const photographer: Actor = { role: 'photographer', canViewFinancials: false }
const editor: Actor = { role: 'editor', canViewFinancials: false }

describe('permission matrix', () => {
  it('owner can do everything', () => {
    for (const p of ['projects.manage', 'clients.view', 'team.invite', 'finance.manage', 'studio.manage', 'reports.view'] as const) {
      expect(can(owner, p)).toBe(true)
    }
  })

  it('financial access is explicit for managers', () => {
    expect(hasFinanceAccess(managerNoFin)).toBe(false)
    expect(can(managerNoFin, 'finance.view')).toBe(false)
    expect(can(managerNoFin, 'projects.manage')).toBe(true)
    expect(can(managerFin, 'finance.view')).toBe(true)
    expect(can(managerFin, 'finance.manage')).toBe(true)
  })

  it('only the owner can invite people or edit studio settings', () => {
    expect(can(managerFin, 'team.invite')).toBe(false)
    expect(can(managerFin, 'studio.manage')).toBe(false)
  })

  it('crew have no access to clients, team admin, equipment admin or money', () => {
    for (const actor of [photographer, editor]) {
      for (const p of ['clients.view', 'team.view', 'equipment.view', 'finance.view', 'reports.view', 'projects.manage'] as const) {
        expect(can(actor, p)).toBe(false)
      }
      expect(can(actor, 'projects.view')).toBe(true)
      expect(can(actor, 'calendar.view')).toBe(true)
    }
  })

  it('denies everything when signed out', () => {
    expect(can(null, 'overview.view')).toBe(false)
    expect(visibleNav(undefined)).toEqual([])
  })

  it('hides navigation the role cannot use', () => {
    const labels = (a: Actor) => visibleNav(a).map((n) => n.label)
    expect(labels(owner)).toEqual(['Overview', 'Events', 'Calendar', 'Clients', 'Team', 'Equipment', 'Payments', 'Production', 'Deliveries', 'Reports'])
    expect(labels(managerNoFin)).not.toContain('Payments')
    expect(labels(managerFin)).toContain('Payments')
    expect(labels(photographer)).toEqual(['Overview', 'Events', 'Calendar', 'Production', 'Deliveries'])
  })

  it('limits checklist phases by role', () => {
    expect(canCompletePhase('photographer', 'shoot')).toBe(true)
    expect(canCompletePhase('photographer', 'editing')).toBe(false)
    expect(canCompletePhase('editor', 'editing')).toBe(true)
    expect(canCompletePhase('editor', 'delivery')).toBe(false)
    expect(canCompletePhase('manager', 'delivery')).toBe(true)
  })
})

describe('sidebar highlighting', () => {
  const item = (key: string) => NAV_ITEMS.find((n) => n.key === key)!
  const active = (path: string, search = '') => NAV_ITEMS.filter((n) => isNavActive(n, path, search)).map((n) => n.key)

  it('highlights exactly one entry for every route', () => {
    for (const [path, search] of [['/', ''], ['/events', ''], ['/events/abc', ''], ['/events/new', ''], ['/calendar', ''], ['/clients/xyz', ''], ['/payments', ''], ['/reports', '']] as const) {
      expect(active(path, search), `${path}${search}`).toHaveLength(1)
    }
    expect(active('/')).toEqual(['overview'])
    expect(active('/events/abc')).toEqual(['events'])
    expect(active('/clients/xyz')).toEqual(['clients'])
  })

  it('uses the stage filter to pick Events, Production or Deliveries', () => {
    expect(active('/events', '?stage=production')).toEqual(['production'])
    expect(active('/events', '?stage=editing')).toEqual(['production'])
    expect(active('/events', '?stage=ready_for_delivery')).toEqual(['deliveries'])
    expect(active('/events', '?stage=delivered')).toEqual(['deliveries'])
    expect(active('/events', '?stage=upcoming')).toEqual(['events'])
    expect(active('/events', '?booking=cancelled')).toEqual(['events'])
  })

  it('points Production and Deliveries at filtered Events lists, not new pages', () => {
    expect(item('production').to).toBe('/events?stage=production')
    expect(item('deliveries').to).toBe('/events?stage=ready_for_delivery')
  })
})
