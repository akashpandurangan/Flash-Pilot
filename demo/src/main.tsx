import './guard-install' // must stay first: activates the network guard before any other module runs
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from '@/App'
import { TooltipProvider } from '@/components/ui/menu'
import { AppearanceProvider, ThemedToaster } from '@/features/appearance/AppearanceProvider'
import './entry.css'
import { AuthProvider } from './auth/AuthProvider'
import { DemoBar } from './DemoBar'

/**
 * Entry point of the interactive demo. It assembles the same providers as the real app (src/main.tsx) around the same <App/>;
 * the only differences are the demo's sign-in stand-in, the "Interactive demo" bar, and the network guard (./guard-install).
 * All data comes from the in-memory layer in ./store (see vite.config.ts for how the backend modules are swapped out at build time).
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status
        const code = (error as { code?: string } | null)?.code
        if ((status && status >= 400 && status < 500) || code === '42501' || code === 'PGRST116' || code === 'P0002') return false
        return failureCount < 2
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider delayDuration={250}>
          <AuthProvider>
            <AppearanceProvider>
              <App />
              <ThemedToaster />
              <DemoBar />
            </AppearanceProvider>
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
