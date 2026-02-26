import { useState, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthGate } from './AuthGate'
import { AppLayout } from './AppLayout'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { useAppStore } from '@/stores/useAppStore'
import { useBackendStatus } from '@/hooks/useBackendStatus'
import { useLiveData } from '@/hooks/useLiveData'
import { CommandPalette } from '@/components/shared/CommandPalette'

import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { StrategiesPage } from '@/features/strategies/StrategiesPage'
import { MarketsPage } from '@/features/markets/MarketsPage'
import { OrdersPage } from '@/features/orders/OrdersPage'
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'
import { HooksPage } from '@/features/hooks/HooksPage'
import { DocsPage } from '@/features/docs/DocsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const screens = {
  dashboard: DashboardPage,
  strategies: StrategiesPage,
  markets: MarketsPage,
  orders: OrdersPage,
  analytics: AnalyticsPage,
  hooks: HooksPage,
  docs: DocsPage,
  settings: SettingsPage,
} as const

function AppContent() {
  const { activeScreen } = useAppStore()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Backend health check
  useBackendStatus()

  // WebSocket live data connection (connects when app is unlocked)
  useLiveData()

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K -> command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen((prev) => !prev)
      }
      // Escape -> close command palette
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const Screen = screens[activeScreen]

  return (
    <>
      <AppLayout>
        <ErrorBoundary>
          <Screen />
        </ErrorBoundary>
      </AppLayout>
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <AuthGate>
          <AppContent />
        </AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
