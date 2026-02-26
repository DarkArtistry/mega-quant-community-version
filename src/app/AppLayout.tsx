import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { StatusBar } from '@/components/layout/StatusBar'
import { useAppStore } from '@/stores/useAppStore'
import { ScrollArea } from '@/components/ui/scroll-area'

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
        <ScrollArea className="flex-1">
          <main className="p-4">{children}</main>
        </ScrollArea>
        <StatusBar />
      </div>
    </div>
  )
}
