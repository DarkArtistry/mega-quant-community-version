import { Search, Sun, Moon, Lock } from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { AppScreen } from '@/types'

const screenTitles: Record<AppScreen, string> = {
  dashboard: 'Dashboard',
  strategies: 'Strategies',
  markets: 'Markets',
  orders: 'Orders',
  analytics: 'Analytics',
  hooks: 'V4 Hooks',
  docs: 'Documentation',
  settings: 'Settings',
}

interface TopBarProps {
  onCommandPalette?: () => void
}

export function TopBar({ onCommandPalette }: TopBarProps) {
  const { theme, toggleTheme, lock, activeScreen } = useAppStore()

  return (
    <header className="flex items-center h-topbar px-4 bg-surface border-b border-border drag-region">
      {/* Left: macOS traffic light spacer + breadcrumb */}
      <div className="flex items-center gap-3 flex-1 no-drag">
        <div className="w-[60px]" /> {/* Traffic light spacer */}
        <span className="text-xs font-medium text-foreground">
          {screenTitles[activeScreen]}
        </span>
      </div>

      {/* Center: Search */}
      <div className="no-drag">
        <button
          onClick={onCommandPalette}
          className={cn(
            'flex items-center gap-2 h-7 px-3 rounded border border-border-subtle',
            'bg-background text-text-tertiary text-xs hover:border-border transition-colors',
            'min-w-[200px]'
          )}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto text-2xs text-text-tertiary bg-surface-hover px-1 py-0.5 rounded">
            {navigator.platform.includes('Mac') ? '\u2318K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 flex-1 justify-end no-drag">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={lock}
          className="flex items-center justify-center w-7 h-7 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-colors"
          title="Lock vault"
        >
          <Lock className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  )
}
