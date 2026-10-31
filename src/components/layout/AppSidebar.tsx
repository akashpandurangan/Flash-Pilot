import { useQuery } from '@tanstack/react-query'
import {
  Aperture, BarChart3, CalendarCheck, CalendarDays, Camera, ChevronsLeft, ChevronsRight, Contact, IndianRupee,
  LayoutDashboard, LogOut, Settings, UserCog, UsersRound,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { getDashboardKpis } from '@/api/dashboard'
import { Avatar } from '@/components/ui/display'
import { Tooltip } from '@/components/ui/menu'
import { ACCESS_ROLE_LABELS } from '@/lib/constants'
import { isNavActive, NAV_SECTION_LABELS, visibleNav, type NavBadgeKey, type NavItem, type NavSection } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthProvider'
import { useStudio } from '@/features/studio/StudioProvider'
import { StudioSelector } from './StudioSelector'

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard, events: CalendarCheck, calendar: CalendarDays, clients: Contact, team: UsersRound, equipment: Camera,
  payments: IndianRupee, reports: BarChart3, settings: Settings, account: UserCog,
}

const SECTIONS: NavSection[] = ['main', 'studio', 'workspace']

interface Props {
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** Called after navigating (closes the mobile drawer). */
  onNavigate?: () => void
}

/** The floating white sidebar: brand, studio selector, grouped navigation with live counts, profile. */
export function AppSidebar({ collapsed = false, onToggleCollapsed, onNavigate }: Props) {
  const { actor, studio, me, role } = useStudio()
  const { signOut } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()

  // Same query key as the dashboard, so the numbers are shared and refreshed together (including via Realtime).
  const kpis = useQuery({ queryKey: ['dashboard', studio.id], queryFn: () => getDashboardKpis(studio.id), staleTime: 30_000 })

  const counts: Record<NavBadgeKey, number | undefined> = {
    // open work: confirmed events in progress plus inquiries still being decided
    events: kpis.data ? kpis.data.active_projects + kpis.data.inquiries : undefined,
  }

  const items = visibleNav(actor)

  const link = (item: NavItem) => {
    const Icon = ICONS[item.icon ?? item.key] ?? LayoutDashboard
    const active = isNavActive(item, pathname, search)
    const count = item.badge ? counts[item.badge] : undefined
    const el = (
      <Link
        key={item.key}
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? `${item.label}${count ? `, ${count}` : ''}` : undefined}
        className={cn(
          'group relative flex h-10 items-center gap-2.5 rounded-full px-3 text-sm font-medium transition-colors [@media(max-height:800px)]:h-[34px]',
          active ? 'bg-brand text-on-brand' : 'text-ink-muted hover:bg-subtle hover:text-ink',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {!collapsed && count !== undefined && count > 0 && (
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums', active ? 'bg-on-brand/15 text-on-brand' : 'bg-subtle text-ink-muted group-hover:bg-surface')}>
            {count > 99 ? '99+' : count}
          </span>
        )}
        {collapsed && count !== undefined && count > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden />}
      </Link>
    )
    return collapsed ? <Tooltip key={item.key} content={item.label} side="right">{el}</Tooltip> : el
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {collapsed && onToggleCollapsed ? (
        /* Collapsed: just the logo. Pointing at it (or focusing it) swaps in the expand chevron; the button is the
           same size as the logo, so nothing moves. */
        <div className="flex justify-center pb-3">
          <Tooltip content="Expand sidebar" side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expand sidebar"
              className="group relative flex size-10 items-center justify-center rounded-xl bg-dark text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Aperture className="size-5 transition-opacity duration-150 group-hover:opacity-20 group-focus-visible:opacity-20 [@media(hover:none)]:opacity-25" aria-hidden />
              <ChevronsRight className="absolute size-[18px] text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-hidden />
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 px-0.5 pb-3">
          <Link to="/" onClick={onNavigate} aria-label="Flash Pilot - overview" className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-dark text-accent"><Aperture className="size-5" aria-hidden /></span>
            <span className="truncate text-[19px] font-semibold tracking-tight">Flash Pilot</span>
          </Link>
          {onToggleCollapsed && (
            <Tooltip content="Collapse sidebar" side="right">
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-muted transition-colors hover:bg-line hover:text-ink"
              >
                <ChevronsLeft className="size-4" />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      <StudioSelector collapsed={collapsed} />

      {/* on short screens rows and gaps tighten (34px rows) so the whole menu stays in view */}
      <nav aria-label="Main" className="mt-3 min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-0.5 scrollbar-thin [@media(max-height:800px)]:mt-2 [@media(max-height:800px)]:space-y-2">
        {SECTIONS.map((section) => {
          const sectionItems = items.filter((i) => i.section === section)
          if (sectionItems.length === 0) return null
          return (
            <div key={section} className="space-y-1">
              {section !== 'main' && !collapsed && (
                <p className="px-3 pb-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">{NAV_SECTION_LABELS[section]}</p>
              )}
              {section !== 'main' && collapsed && <div className="mx-3 my-1.5 h-px bg-line" aria-hidden />}
              {sectionItems.map(link)}
            </div>
          )
        })}
      </nav>

      <div className="mt-2 border-t border-line pt-2.5 [@media(max-height:800px)]:pt-2">
        <div className={cn('flex items-center gap-2 rounded-2xl p-1.5', collapsed ? 'flex-col' : 'bg-subtle')}>
          <Link to="/account" onClick={onNavigate} aria-label={`${me.full_name} - account`} className={cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-xl', collapsed && 'flex-none')}>
            <Avatar name={me.full_name} className="size-9 bg-surface" />
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-tight">{me.full_name}</span>
                <span className="block truncate text-[11px] text-ink-muted">{ACCESS_ROLE_LABELS[role]}</span>
              </span>
            )}
          </Link>
          <Tooltip content="Sign out" side={collapsed ? 'right' : 'top'}>
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => {
                void signOut().then(() => navigate('/login', { replace: true })).catch(() => toast.error('Could not sign out. Please try again.'))
              }}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <LogOut className="size-[18px]" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
