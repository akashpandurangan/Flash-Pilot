import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface State {
  error: Error | null
}

/** Last line of defence: a crash in one screen shows a recovery panel instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; fullScreen?: boolean }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged, never swallowed - wire this to an error tracker in production.
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className={this.props.fullScreen ? 'flex min-h-dvh items-center justify-center p-6' : 'flex items-center justify-center p-10'}>
        <div className="max-w-md text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" aria-hidden /></div>
          <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
          <p className="mt-1 text-sm text-ink-muted">Your data is safe. Try again, and if it keeps happening, reload the app.</p>
          <p className="mt-2 break-words rounded bg-subtle px-3 py-2 text-left font-mono text-xs text-ink-muted">{this.state.error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </div>
        </div>
      </div>
    )
  }
}
