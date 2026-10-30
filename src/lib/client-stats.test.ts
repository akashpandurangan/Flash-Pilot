import { describe, expect, it } from 'vitest'
import { clientStats } from './client-stats'

const projects = [
  { id: 'p1', client_id: 'c1', booking_status: 'confirmed' as const },
  { id: 'p2', client_id: 'c1', booking_status: 'inquiry' as const },
  { id: 'p3', client_id: 'c1', booking_status: 'cancelled' as const },
  { id: 'p4', client_id: 'c2', booking_status: 'confirmed' as const },
]

describe('clientStats', () => {
  it('counts each client\'s events and leaves cancelled bookings out', () => {
    const stats = clientStats(projects, null)
    expect(stats.get('c1')?.events).toBe(2)
    expect(stats.get('c2')?.events).toBe(1)
    expect(stats.has('c3')).toBe(false)
  })

  it('adds up what is still owed, ignoring credit and cancelled events', () => {
    const stats = clientStats(projects, [
      { project_id: 'p1', balance: 40_000 },
      { project_id: 'p2', balance: 10_000 },
      { project_id: 'p3', balance: 99_000 }, // cancelled - not owed
      { project_id: 'p4', balance: -5_000 }, // client credit - not owed, and not netted against others
    ])
    expect(stats.get('c1')?.outstanding).toBe(50_000)
    expect(stats.get('c2')?.outstanding).toBe(0)
  })

  it('reports no money for viewers without finance access', () => {
    expect(clientStats(projects, null).get('c1')?.outstanding).toBe(0)
  })

  it('copes with balances that arrive as strings', () => {
    const stats = clientStats(projects, [{ project_id: 'p4', balance: '2500.50' as unknown as number }])
    expect(stats.get('c2')?.outstanding).toBe(2500.5)
  })
})
