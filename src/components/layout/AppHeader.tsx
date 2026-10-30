import { Menu as MenuIcon, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useStudio } from '@/features/studio/StudioProvider'
import { GlobalSearch } from './GlobalSearch'
import { useHeaderSlot } from './header-slot'
import { NotificationPanel } from './NotificationPanel'

const TITLES: [prefix: string, title: string][] = [
  ['/events', 'Events'], ['/calendar', 'Calendar'], ['/clients', 'Clients'], ['/team', 'Team'], ['/equipment', 'Equipment'],
  ['/payments', 'Payments'], ['/notifications', 'Notifications'], ['/reports', 'Reports'], ['/settings', 'Settings'], ['/account', 'Account'],
]

export function pageTitle(pathname: string): string {
  if (pathname === '/') return 'Overview'
  return TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Flash Pilot'
}

/**
 * Top bar: a menu button on small screens, a slot a page can fill (the dashboard puts its greeting
 * there), then search, notifications and the primary "New Event" action.
 */
export function AppHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation()
  const { can } = useStudio()
  const { custom, setTarget } = useHeaderSlot()

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-page/85 px-4 py-2.5 backdrop-blur md:px-6 lg:px-8 lg:py-4">
      <Button variant="secondary" size="icon-lg" className="lg:hidden" onClick={onOpenMenu} aria-label="Open menu"><MenuIcon className="size-[18px]" /></Button>
      <div className="flex min-w-0 flex-1 items-center">
        <div ref={setTarget} className="min-w-0 flex-1 empty:hidden" />
        {/* on large screens each page shows its own heading, so the default title is for phones only */}
        {!custom && <h2 className="truncate text-lg font-semibold tracking-tight lg:hidden">{pageTitle(pathname)}</h2>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <GlobalSearch />
        <NotificationPanel />
        {can('projects.manage') && (
          <Button asChild className="px-3.5 text-[13px] sm:px-4" size="lg">
            <Link to="/events/new" aria-label="New event">
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">New Event</span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  )
}
