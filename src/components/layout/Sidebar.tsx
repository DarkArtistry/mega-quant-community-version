import {
  LayoutDashboard,
  Code2,
  BarChart3,
  ClipboardList,
  TrendingUp,
  Anchor,
  BookOpen,
  Settings,
} from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AppScreen } from '@/types'

interface SidebarProps {
  activeScreen: AppScreen
  onNavigate: (screen: AppScreen) => void
}

const navItems: { screen: AppScreen; icon: React.ElementType; label: string }[] = [
  { screen: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { screen: 'strategies', icon: Code2, label: 'Strategies' },
  { screen: 'markets', icon: BarChart3, label: 'Markets' },
  { screen: 'orders', icon: ClipboardList, label: 'Orders' },
  { screen: 'analytics', icon: TrendingUp, label: 'Analytics' },
  { screen: 'hooks', icon: Anchor, label: 'Hooks' },
  { screen: 'docs', icon: BookOpen, label: 'Docs' },
  { screen: 'settings', icon: Settings, label: 'Settings' },
]

export function Sidebar({ activeScreen, onNavigate }: SidebarProps) {
  return (
    <nav className="flex flex-col items-center w-sidebar bg-surface border-r border-border pt-[52px] pb-2">
      <div className="flex flex-col items-center gap-0.5 flex-1">
        {navItems.slice(0, -1).map(({ screen, icon: Icon, label }) => (
          <Tooltip key={screen} delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onNavigate(screen)}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded transition-colors',
                  activeScreen === screen
                    ? 'bg-surface-active text-foreground'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-col items-center">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onNavigate('settings')}
              className={cn(
                'flex items-center justify-center w-9 h-9 rounded transition-colors',
                activeScreen === 'settings'
                  ? 'bg-surface-active text-foreground'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
              )}
            >
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
