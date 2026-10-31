import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { TooltipProvider } from '@/components/ui/menu'
import { AppearanceProvider, ThemedToaster } from '@/features/appearance/AppearanceProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on permission or validation errors; do retry flaky networks.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status
        const code = (error as { code?: string } | null)?.code
        if ((status && status >= 400 && status < 500) || code === '42501' || code === 'PGRST116') return false
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
            </AppearanceProvider>
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
