import { Compass } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { ConfigMissing } from '@/components/layout/ConfigMissing'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LegacyProjectsRedirect } from '@/components/LegacyProjectsRedirect'
import { Button } from '@/components/ui/button'
import { EmptyState, Spinner } from '@/components/ui/display'
import { isSupabaseConfigured } from '@/lib/env'
import { ForgotPasswordPage, FullPageSpinner, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/AuthPages'
import { RequireAuth, RequirePermission, StudioGate } from '@/features/studio/StudioProvider'
import type { Permission } from '@/lib/permissions'
import type { ReactNode } from 'react'

// Route-level code splitting: each screen loads on first visit.
const OnboardingPage = lazy(() => import('@/features/studio/OnboardingPage'))
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'))
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'))
const ProjectFormPage = lazy(() => import('@/features/projects/ProjectFormPage'))
const ProjectDetailPage = lazy(() => import('@/features/projects/ProjectDetailPage'))
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'))
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage'))
const ClientDetailPage = lazy(() => import('@/features/clients/ClientDetailPage'))
const TeamPage = lazy(() => import('@/features/team/TeamPage'))
const EquipmentPage = lazy(() => import('@/features/equipment/EquipmentPage'))
const PaymentsPage = lazy(() => import('@/features/payments/PaymentsPage'))
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))
const AccountPage = lazy(() => import('@/features/settings/AccountPage'))

function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  return <RequirePermission permission={permission}>{children}</RequirePermission>
}

function PageFallback() {
  return <div className="flex justify-center py-24"><Spinner className="size-6" /></div>
}

function NotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={<Button asChild><Link to="/">Go to overview</Link></Button>}
      className="mx-auto mt-16 max-w-lg"
    />
  )
}

/** Remount the error boundary on navigation so one broken page doesn't poison the rest. */
function RoutedBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />

  return (
    <ErrorBoundary fullScreen>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/projects" element={<LegacyProjectsRedirect />} />
          <Route path="/projects/*" element={<LegacyProjectsRedirect />} />

          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<StudioGate />}>
              <Route element={<AppShell />}>
                <Route index element={<RoutedBoundary><Suspense fallback={<PageFallback />}><DashboardPage /></Suspense></RoutedBoundary>} />
                <Route path="/events" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><ProjectsPage /></Suspense></RoutedBoundary>} />
                <Route path="/events/new" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="projects.manage"><ProjectFormPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/events/:id" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><ProjectDetailPage /></Suspense></RoutedBoundary>} />
                <Route path="/events/:id/edit" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="projects.manage"><ProjectFormPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/calendar" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><CalendarPage /></Suspense></RoutedBoundary>} />
                <Route path="/clients" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="clients.view"><ClientsPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/clients/:id" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="clients.view"><ClientDetailPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/team" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="team.view"><TeamPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/equipment" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="equipment.view"><EquipmentPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/payments" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="finance.view"><PaymentsPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/notifications" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><NotificationsPage /></Suspense></RoutedBoundary>} />
                <Route path="/reports" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="reports.view"><ReportsPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/settings" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><Guard permission="studio.manage"><SettingsPage /></Guard></Suspense></RoutedBoundary>} />
                <Route path="/account" element={<RoutedBoundary><Suspense fallback={<PageFallback />}><AccountPage /></Suspense></RoutedBoundary>} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
