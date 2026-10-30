import { WifiOff } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { useStudio } from '@/features/studio/StudioProvider'
import { useLocalStorageState, useOnline } from '@/hooks/hooks'
import { useRealtimeSync, type LiveStatus } from '@/hooks/useRealtimeSync'
import { AppHeader } from './AppHeader'
import { AppSidebar } from './AppSidebar'
import { HeaderSlotProvider } from './header-slot'

function ConnectionBanner({ live }: { live: LiveStatus }) {
  const online = useOnline()
  if (!online) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-warning">
        <WifiOff className="size-3.5" aria-hidden /> You're offline. Changes can't be saved until your connection returns.
      </div>
    )
  }
  if (live === 'reconnecting') {
    return <div role="status" className="bg-subtle px-4 py-1.5 text-center text-xs text-ink-muted">Live updates paused - reconnecting…</div>
  }
  return null
}

/**
 * The application frame: a floating sidebar on large screens (collapsible to an icon rail), a slide-in
 * drawer below 1024px, and a sticky header over the scrolling page.
 */
export function AppShell() {
  const { studio, me } = useStudio()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useLocalStorageState<'0' | '1'>('fp.sidebar.collapsed', '0')
  const [drawer, setDrawer] = useState(false)
  const live = useRealtimeSync(studio.id, me.id)
  const isCollapsed = collapsed === '1'

  // Navigating always closes the mobile drawer.
  useEffect(() => setDrawer(false), [pathname])

  return (
    <HeaderSlotProvider>
      <div className="min-h-dvh bg-page">
        <a href="#main" className="sr-only z-[100] rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>

        {/* Desktop / large tablet sidebar */}
        <aside
          className={cn(
            'fixed bottom-3 left-3 top-3 z-30 hidden rounded-panel border border-line bg-surface shadow-float transition-[width,padding] duration-200 lg:block',
            isCollapsed ? 'w-[76px] p-3' : 'w-[256px] p-4 [@media(max-height:800px)]:py-3',
          )}
        >
          <AppSidebar collapsed={isCollapsed} onToggleCollapsed={() => setCollapsed(isCollapsed ? '0' : '1')} />
        </aside>

        {/* Drawer for phones and tablets */}
        <RadixDialog.Root open={drawer} onOpenChange={setDrawer}>
          <RadixDialog.Portal>
            <RadixDialog.Overlay className="fixed inset-0 z-40 bg-dark/40 lg:hidden" />
            <RadixDialog.Content className="fixed inset-y-3 left-3 z-50 w-[272px] max-w-[88vw] rounded-panel bg-surface p-4 shadow-pop [animation:fp-slide-in-left_.2s_ease-out] lg:hidden">
              <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
              <RadixDialog.Description className="sr-only">Main navigation menu</RadixDialog.Description>
              <AppSidebar onNavigate={() => setDrawer(false)} />
            </RadixDialog.Content>
          </RadixDialog.Portal>
        </RadixDialog.Root>

        <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', isCollapsed ? 'lg:pl-[104px]' : 'lg:pl-[284px]')}>
          <ConnectionBanner live={live} />
          <AppHeader onOpenMenu={() => setDrawer(true)} />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-10 pt-1 outline-none md:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </HeaderSlotProvider>
  )
}
