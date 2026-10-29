import { DropdownMenu, Tabs as RadixTabs, Tooltip as RadixTooltip } from 'radix-ui'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------ dropdown menu */
export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export function MenuContent({ className, align = 'end', ...props }: ComponentPropsWithoutRef<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-48 overflow-hidden rounded-lg border border-line bg-canvas p-1 shadow-pop [animation:fp-pop-in_.12s_ease-out]', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  )
}

export function MenuItem({ className, danger, icon, children, ...props }: ComponentPropsWithoutRef<typeof DropdownMenu.Item> & { danger?: boolean; icon?: ReactNode }) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-subtle',
        danger && 'text-danger data-[highlighted]:bg-danger-soft',
        className,
      )}
      {...props}
    >
      {icon && <span className="text-ink-muted [&>svg]:size-4" aria-hidden>{icon}</span>}
      {children}
    </DropdownMenu.Item>
  )
}

export const MenuSeparator = ({ className }: { className?: string }) => <DropdownMenu.Separator className={cn('my-1 h-px bg-line', className)} />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-medium text-ink-muted">{children}</DropdownMenu.Label>
)

/* ---------------------------------------------------------------------- tabs */
export const Tabs = RadixTabs.Root

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <div className="relative -mx-4 overflow-x-auto px-4 scrollbar-thin md:mx-0 md:px-0">
      <RadixTabs.List className={cn('flex min-w-max gap-1 border-b border-line', className)} {...props} />
    </div>
  )
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-ink-muted transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = ({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.Content>) => (
  <RadixTabs.Content className={cn('pt-5 outline-none', className)} {...props} />
)

/* ------------------------------------------------------------------- tooltip */
export const TooltipProvider = RadixTooltip.Provider

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RadixTooltip.Root delayDuration={250}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={side} sideOffset={6} className="z-[60] max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs text-white shadow-pop">
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
