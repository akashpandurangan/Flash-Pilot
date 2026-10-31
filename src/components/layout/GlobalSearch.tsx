import { useQuery } from '@tanstack/react-query'
import { Contact, FolderKanban, Search, UsersRound } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { globalSearch } from '@/api/dashboard'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/display'
import { BookingBadge } from '@/components/ui/status'
import { TEAM_ROLE_LABELS } from '@/lib/constants'
import { useStudio } from '@/features/studio/StudioProvider'
import { useDebounced } from '@/hooks/hooks'

/** Header search (Ctrl/⌘+K): projects, clients and team - each limited by what the role may read. */
export function GlobalSearch() {
  const { studio, can } = useStudio()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim(), 250)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useQuery({
    queryKey: ['search', studio.id, debounced],
    queryFn: () => globalSearch(studio.id, debounced, can('clients.view'), can('team.view')),
    enabled: open && debounced.length >= 2,
    staleTime: 15_000,
  })

  const close = () => {
    setOpen(false)
    setTerm('')
  }
  const r = results.data
  const empty = r && r.projects.length + r.clients.length + r.employees.length === 0

  return (
    <RadixDialog.Root open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <RadixDialog.Trigger asChild>
        <Button variant="secondary" size="lg" className="hidden w-56 justify-start gap-2 border-line px-3.5 text-[13px] font-normal text-ink-muted lg:inline-flex min-[1440px]:w-64" aria-label="Search">
          <Search className="size-4" />
          <span className="min-[1440px]:hidden">Search…</span>
          <span className="hidden min-[1440px]:inline">Search events, clients…</span>
          <kbd className="ml-auto rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-ink-muted">Ctrl K</kbd>
        </Button>
      </RadixDialog.Trigger>
      <RadixDialog.Trigger asChild>
        <Button variant="secondary" size="icon-lg" className="border-line lg:hidden" aria-label="Search"><Search className="size-[18px]" /></Button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40 [animation:fp-fade-in_.15s_ease-out]" />
        <RadixDialog.Content className="fixed left-1/2 top-[8dvh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-line bg-surface shadow-pop [animation:fp-pop-in_.15s_ease-out]">
          <RadixDialog.Title className="sr-only">Search</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Search events, clients and team members</RadixDialog.Description>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-ink-muted" aria-hidden />
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search events, clients, team…"
              aria-label="Search"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-muted"
            />
            {results.isFetching && <Spinner className="size-4" />}
          </div>
          <div className="max-h-[60dvh] overflow-y-auto p-2">
            {debounced.length < 2 && <p className="px-3 py-6 text-center text-sm text-ink-muted">Type at least 2 characters.</p>}
            {results.isError && <p role="alert" className="px-3 py-6 text-center text-sm text-danger">Search failed. Try again.</p>}
            {empty && <p className="px-3 py-6 text-center text-sm text-ink-muted">No matches for “{debounced}”.</p>}
            {r && r.projects.length > 0 && (
              <Group label="Events">
                {r.projects.map((p) => (
                  <Hit key={p.id} to={`/events/${p.id}`} icon={<FolderKanban />} onClick={close} title={p.name} meta={`${p.project_code} · ${p.client_name}`} right={<BookingBadge status={p.booking_status} />} />
                ))}
              </Group>
            )}
            {r && r.clients.length > 0 && (
              <Group label="Clients">
                {r.clients.map((c) => <Hit key={c.id} to={`/clients/${c.id}`} icon={<Contact />} onClick={close} title={c.full_name} meta={[c.phone, c.email].filter(Boolean).join(' · ')} />)}
              </Group>
            )}
            {r && r.employees.length > 0 && (
              <Group label="Team">
                {r.employees.map((e) => <Hit key={e.id} to={`/team?q=${encodeURIComponent(e.full_name)}`} icon={<UsersRound />} onClick={close} title={e.full_name} meta={`${TEAM_ROLE_LABELS[e.team_role]}${e.is_active ? '' : ' · inactive'}`} />)}
              </Group>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-xs font-medium text-ink-muted">{label}</p>
      <ul>{children}</ul>
    </div>
  )
}

function Hit({ to, icon, title, meta, right, onClick }: { to: string; icon: React.ReactNode; title: string; meta?: string; right?: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <Link to={to} onClick={onClick} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-subtle focus-visible:bg-subtle">
        <span className="text-ink-muted [&>svg]:size-4" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {meta && <span className="block truncate text-xs text-ink-muted">{meta}</span>}
        </span>
        {right}
      </Link>
    </li>
  )
}
