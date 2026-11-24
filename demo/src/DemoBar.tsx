import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LayoutDashboard, LogOut, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { EXIT_URL } from './store/core'
import { resetDb } from './store/db'

const KEY = 'fp.demo.bar.collapsed'

function readCollapsed(): boolean {
  try {
    const saved = window.sessionStorage.getItem(KEY)
    if (saved !== null) return saved === '1'
  } catch { /* storage can be blocked; fall back to the default */ }
  return window.matchMedia('(max-width: 639px)').matches
}

/**
 * The "this is a demo" indicator, always on screen (a pill at the bottom of the window, collapsible to a small chip but never
 * hidden). It is the demo's only addition to the app's own interface: a way back to the dashboard, a way to start over with
 * fresh sample data, and a way out to the portfolio. Styled in demo-bar.css with the app's own colour tokens.
 */
export function DemoBar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    try { window.sessionStorage.setItem(KEY, collapsed ? '1' : '0') } catch { /* optional */ }
  }, [collapsed])

  const reset = () => {
    resetDb()
    navigate('/')
    void qc.invalidateQueries()
    toast.success('Demo reset', { description: 'The sample data is back to how it started.' })
  }

  const label = (
    <span className="demo-bar__label">
      <span className="demo-bar__dot" aria-hidden>
        <span className="demo-bar__ping" />
        <span className="demo-bar__core" />
      </span>
      Interactive demo
    </span>
  )

  if (collapsed) {
    return (
      <div className="demo-bar" data-testid="demo-bar" data-collapsed="true">
        <button type="button" className="demo-bar__chip" onClick={() => setCollapsed(false)} aria-label="Interactive demo - show demo controls" aria-expanded={false}>
          {label}
          <ChevronDown size={16} aria-hidden style={{ transform: 'rotate(180deg)', opacity: 0.7 }} />
        </button>
      </div>
    )
  }

  return (
    <div className="demo-bar" data-testid="demo-bar" data-collapsed="false">
      <div className="demo-bar__panel" role="region" aria-label="Interactive demo controls">
        {label}
        <span className="demo-bar__divider" aria-hidden />
        <button type="button" className="demo-bar__action" onClick={() => navigate('/')} disabled={pathname === '/'} aria-label="Back to the demo dashboard">
          <LayoutDashboard size={14} aria-hidden />
          <span>Dashboard</span>
        </button>
        <button type="button" className="demo-bar__action" onClick={reset} aria-label="Reset the demo data">
          <RotateCcw size={14} aria-hidden />
          <span>Reset</span>
        </button>
        <a href={EXIT_URL} className="demo-bar__exit">
          <LogOut size={14} aria-hidden />
          <span>Exit demo</span>
        </a>
        <button type="button" className="demo-bar__icon" onClick={() => setCollapsed(true)} aria-label="Minimise the demo controls" aria-expanded>
          <ChevronDown size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}
