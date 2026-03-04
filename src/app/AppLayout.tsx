import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { useAppStore } from '@/stores/useAppStore'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const { activeScreen, setActiveScreen } = useAppStore()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeScreen={activeScreen} onNavigate={setActiveScreen} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <div className="flex-1 overflow-auto">
          <main className="p-4">{children}</main>
        </div>
        <StatusBar />
      </div>
    </div>
  )
}
