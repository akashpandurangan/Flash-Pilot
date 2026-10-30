import { Aperture, Check, ChevronsUpDown, Settings, UserCog } from 'lucide-react'
import { useNavigate } from 'react-router'
import { logoUrl } from '@/api/studio'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import { useStudio } from '@/features/studio/StudioProvider'

/**
 * Shows which studio you are working in. A person belongs to one studio today, so the menu shows
 * it as the current one and offers its settings - there is deliberately no fake "switch studio".
 */
export function StudioSelector({ collapsed }: { collapsed?: boolean }) {
  const { studio, can } = useStudio()
  const navigate = useNavigate()
  const url = logoUrl(studio.logo_path)
  const place = [studio.city, studio.state].filter(Boolean).join(', ')

  const tile = (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-surface ring-1 ring-line">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : <Aperture className="size-5 text-ink" aria-hidden />}
    </span>
  )

  const trigger = (
    <button
      type="button"
      aria-label={`Studio: ${studio.name}`}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-2xl bg-subtle p-2.5 text-left transition-colors hover:bg-line/60',
        collapsed && 'justify-center bg-transparent p-0 hover:bg-transparent',
      )}
    >
      {tile}
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{studio.name}</span>
            <span className="block truncate text-[11px] text-ink-muted">{place || 'Add a location in settings'}</span>
          </span>
          <ChevronsUpDown className="mr-1 size-4 shrink-0 text-ink-faint" aria-hidden />
        </>
      )}
    </button>
  )

  return (
    <Menu>
      {collapsed ? <Tooltip content={studio.name} side="right"><MenuTrigger asChild>{trigger}</MenuTrigger></Tooltip> : <MenuTrigger asChild>{trigger}</MenuTrigger>}
      <MenuContent align="start" className="w-64">
        <MenuLabel>Your studio</MenuLabel>
        <MenuItem icon={<Check />} disabled className="opacity-100">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{studio.name}</span>
            {place && <span className="block truncate text-xs text-ink-muted">{place}</span>}
          </span>
        </MenuItem>
        <MenuSeparator />
        {can('studio.manage') && (
          <MenuItem icon={<Settings />} onSelect={() => navigate('/settings')}>Studio settings</MenuItem>
        )}
        <MenuItem icon={<UserCog />} onSelect={() => navigate('/account')}>Account settings</MenuItem>
      </MenuContent>
    </Menu>
  )
}
