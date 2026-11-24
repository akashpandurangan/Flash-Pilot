/**
 * Type-only guard (never imported by the app). Each demo module must offer everything the real module does, with compatible
 * types - so if the real API changes shape, `npm run demo:typecheck` fails here and the demo is updated deliberately,
 * instead of silently drifting. The real modules are imported for their TYPES only; nothing from them reaches the demo bundle.
 */
import type * as RealAppearance from '@/api/appearance'
import type * as RealClients from '@/api/clients'
import type * as RealCore from '@/api/core'
import type * as RealDashboard from '@/api/dashboard'
import type * as RealEmployees from '@/api/employees'
import type * as RealEquipment from '@/api/equipment'
import type * as RealNotifications from '@/api/notifications'
import type * as RealPayments from '@/api/payments'
import type * as RealProjects from '@/api/projects'
import type * as RealSchedule from '@/api/schedule'
import type * as RealStudio from '@/api/studio'
import type * as RealAuth from '@/features/auth/AuthProvider'
import type * as RealRealtime from '@/hooks/useRealtimeSync'
import type * as RealEnv from '@/lib/env'
import * as DemoAppearance from './api/appearance'
import * as DemoClients from './api/clients'
import * as DemoCore from './api/core'
import * as DemoDashboard from './api/dashboard'
import * as DemoEmployees from './api/employees'
import * as DemoEquipment from './api/equipment'
import * as DemoNotifications from './api/notifications'
import * as DemoPayments from './api/payments'
import * as DemoProjects from './api/projects'
import * as DemoSchedule from './api/schedule'
import * as DemoStudio from './api/studio'
import * as DemoAuth from './auth/AuthProvider'
import * as DemoRealtime from './hooks/useRealtimeSync'
import * as DemoEnv from './lib/env'

export const parity = {
  appearance: DemoAppearance satisfies typeof RealAppearance,
  clients: DemoClients satisfies typeof RealClients,
  core: DemoCore satisfies typeof RealCore,
  dashboard: DemoDashboard satisfies typeof RealDashboard,
  employees: DemoEmployees satisfies typeof RealEmployees,
  equipment: DemoEquipment satisfies typeof RealEquipment,
  notifications: DemoNotifications satisfies typeof RealNotifications,
  payments: DemoPayments satisfies typeof RealPayments,
  projects: DemoProjects satisfies typeof RealProjects,
  schedule: DemoSchedule satisfies typeof RealSchedule,
  studio: DemoStudio satisfies typeof RealStudio,
  auth: DemoAuth satisfies typeof RealAuth,
  realtime: DemoRealtime satisfies typeof RealRealtime,
  env: DemoEnv satisfies typeof RealEnv,
}
