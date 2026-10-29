import {
  Aperture, BarChart3, Bell, CalendarDays, Camera, ChevronsLeft, ChevronsRight, Contact, FolderKanban, IndianRupee, LayoutDashboard,
  LogOut, Menu as MenuIcon, Settings, UserCog, UsersRound, WifiOff,
} from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useState, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { logoUrl } from '@/api/studio'
import { Avatar } from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/menu'
import { ACCESS_ROLE_LABELS } from '@/lib/constants'
import { visibleNav } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthProvider'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { useStudio } from '@/features/studio/StudioProvider'
import { useLocalStorageState, useOnline } from '@/hooks/hooks'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { GlobalSearch } from './GlobalSearch'

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard, projects: FolderKanban, calendar: CalendarDays, clients: Contact, team: UsersRound,
  equipment: Camera, payments: IndianRupee, notifications: Bell, reports: BarChart3, settings: Settings,
}

const TITLES: [prefix: string, title: string][] = [
  ['/events', 'Events'], ['/calendar', 'Calendar'], ['/clients', 'Clients'], ['/team', 'Team'], ['/equipment', 'Equipment'],
  ['/payments', 'Payments'], ['/notifications', 'Notifications'], ['/reports', 'Reports'], ['/settings', 'Studio settings'], ['/account', 'Account'],
]

function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Overview'
  return TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Flash Pilot'
}

function StudioMark({ collapsed }: { collapsed?: boolean }) {
  const { studio } = useStudio()
  const url = logoUrl(studio.logo_path)
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-md px-1 py-1" aria-label={`${studio.name} - overview`}>
      {url ? (
        <img src={url} alt="" className="size-8 shrink-0 rounded-md border border-line object-cover" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-white"><Aperture className="size-[18px]" aria-hidden /></span>
      )}
      {!collapsed && <span className="truncate text-sm font-semibold">{studio.name}</span>}
    </Link>
  )
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { actor } = useStudio()
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2 scrollbar-thin">
      {visibleNav(actor).map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            aria-label={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors md:h-9',
                isActive ? 'bg-ink text-white' : 'text-ink-muted hover:bg-subtle hover:text-ink',
                collapsed && 'justify-center px-0',
              )
            }
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        )
        return collapsed ? <Tooltip key={item.to} content={item.label} side="right">{link}</Tooltip> : link
      })}
    </nav>
  )
}

function ProfileMenu() {
  const { user, signOut } = useAuth()
  const { me, role } = useStudio()
  const navigate = useNavigate()
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full p-0.5 hover:bg-subtle" aria-label="Account menu">
          <Avatar name={me.full_name} className="size-9 md:size-8" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuLabel>
          <span className="block truncate text-sm font-medium text-ink">{me.full_name}</span>
          <span className="block truncate font-normal">{user?.email}</span>
          <span className="mt-0.5 block font-normal">{ACCESS_ROLE_LABELS[role]}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem icon={<UserCog />} onSelect={() => navigate('/account')}>Account settings</MenuItem>
        <MenuItem
          icon={<LogOut />}
          onSelect={() => {
            void signOut().then(() => navigate('/login', { replace: true })).catch(() => toast.error('Could not sign out. Please try again.'))
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function ConnectionBanner({ live }: { live: 'connecting' | 'live' | 'reconnecting' }) {
  const online = useOnline()
  if (!online) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
        <WifiOff className="size-3.5" aria-hidden /> You're offline. Changes can't be saved until your connection returns.
      </div>
    )
  }
  if (live === 'reconnecting') {
    return <div role="status" className="bg-subtle px-4 py-1.5 text-center text-xs text-ink-muted">Live updates paused - reconnecting…</div>
  }
  return null
}

export function AppShell() {
  const { studio, me } = useStudio()
  const location = useLocation()
  const [collapsed, setCollapsed] = useLocalStorageState<'0' | '1'>('fp.sidebar.collapsed', '0')
  const [drawer, setDrawer] = useState(false)
  const live = useRealtimeSync(studio.id, me.id)
  const isCollapsed = collapsed === '1'

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only z-[100] rounded bg-ink px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-sidebar transition-[width] duration-200 md:flex',
          isCollapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-line px-3', isCollapsed && 'justify-center px-0')}>
          <StudioMark collapsed={isCollapsed} />
        </div>
        <NavList collapsed={isCollapsed} />
        <div className="border-t border-line p-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full justify-start text-ink-muted', isCollapsed && 'justify-center px-0')}
            onClick={() => setCollapsed(isCollapsed ? '0' : '1')}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <RadixDialog.Root open={drawer} onOpenChange={setDrawer}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
          <RadixDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-pop [animation:fp-slide-in-left_.2s_ease-out] md:hidden">
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <RadixDialog.Description className="sr-only">Main navigation menu</RadixDialog.Description>
            <div className="flex h-14 items-center border-b border-line px-3"><StudioMark /></div>
            <NavList onNavigate={() => setDrawer(false)} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', isCollapsed ? 'md:pl-16' : 'md:pl-60')}>
        <ConnectionBanner live={live} />
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><MenuIcon className="size-5" /></Button>
          <h2 className="min-w-0 truncate text-sm font-semibold md:text-base">{pageTitle(location.pathname)}</h2>
          <div className="ml-auto flex items-center gap-1.5">
            <GlobalSearch />
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none md:px-6 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
