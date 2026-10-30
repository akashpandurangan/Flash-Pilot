import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface HeaderSlotValue {
  target: HTMLElement | null
  setTarget: (el: HTMLElement | null) => void
  /** True while a page has put its own content (e.g. the dashboard greeting) into the header. */
  custom: boolean
  setCustom: (v: boolean) => void
}

const HeaderSlotContext = createContext<HeaderSlotValue | null>(null)

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [custom, setCustom] = useState(false)
  const value = useMemo(() => ({ target, setTarget, custom, setCustom }), [target, custom])
  return <HeaderSlotContext.Provider value={value}>{children}</HeaderSlotContext.Provider>
}

export function useHeaderSlot(): HeaderSlotValue {
  const ctx = useContext(HeaderSlotContext)
  if (!ctx) throw new Error('useHeaderSlot must be used inside <HeaderSlotProvider>')
  return ctx
}

/** Renders its children in the left side of the app header instead of in the page body. */
export function HeaderContent({ children }: { children: ReactNode }) {
  const { target, setCustom } = useHeaderSlot()
  useEffect(() => {
    setCustom(true)
    return () => setCustom(false)
  }, [setCustom])
  return target ? createPortal(children, target) : null
}
