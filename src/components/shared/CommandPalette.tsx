import { useState, useEffect } from 'react'
import { Command } from 'cmdk'
import {
  LayoutDashboard,
  Code2,
  BarChart3,
  ClipboardList,
  TrendingUp,
  Anchor,
  BookOpen,
  Settings,
  Search,
  Plus,
  Play,
  Sun,
  Moon,
  Lock,
} from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import type { AppScreen } from '@/types'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { setActiveScreen, toggleTheme, lock, theme } = useAppStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  function navigate(screen: AppScreen) {
    setActiveScreen(screen)
    onOpenChange(false)
  }

  function runAction(action: () => void) {
    action()
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg">
        <Command
          className="rounded-lg border border-border bg-surface shadow-xl overflow-hidden"
          shouldFilter={true}
        >
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search className="w-4 h-4 text-text-tertiary shrink-0" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search commands..."
              className="h-10 w-full bg-transparent text-sm text-foreground placeholder:text-text-tertiary focus:outline-none"
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-1">
            <Command.Empty className="py-6 text-center text-xs text-text-tertiary">
              No results found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="px-1 py-1.5">
              <CommandItem icon={LayoutDashboard} onSelect={() => navigate('dashboard')}>
                Dashboard
              </CommandItem>
              <CommandItem icon={Code2} onSelect={() => navigate('strategies')}>
                Strategies
              </CommandItem>
              <CommandItem icon={BarChart3} onSelect={() => navigate('markets')}>
                Markets
              </CommandItem>
              <CommandItem icon={ClipboardList} onSelect={() => navigate('orders')}>
                Orders
              </CommandItem>
              <CommandItem icon={TrendingUp} onSelect={() => navigate('analytics')}>
                Analytics
              </CommandItem>
              <CommandItem icon={Anchor} onSelect={() => navigate('hooks')}>
                V4 Hooks
              </CommandItem>
              <CommandItem icon={BookOpen} onSelect={() => navigate('docs')}>
                Documentation
              </CommandItem>
              <CommandItem icon={Settings} onSelect={() => navigate('settings')}>
                Settings
              </CommandItem>
            </Command.Group>

            <Command.Group heading="Actions" className="px-1 py-1.5">
              <CommandItem icon={Plus} onSelect={() => navigate('strategies')}>
                New Strategy
              </CommandItem>
              <CommandItem
                icon={theme === 'dark' ? Sun : Moon}
                onSelect={() => runAction(toggleTheme)}
              >
                Toggle Theme
              </CommandItem>
              <CommandItem icon={Lock} onSelect={() => runAction(lock)}>
                Lock Vault
              </CommandItem>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  )
}

function CommandItem({
  children,
  icon: Icon,
  onSelect,
}: {
  children: React.ReactNode
  icon: React.ElementType
  onSelect: () => void
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-secondary cursor-pointer data-[selected=true]:bg-surface-hover data-[selected=true]:text-foreground"
    >
      <Icon className="w-3.5 h-3.5 text-text-tertiary" />
      {children}
    </Command.Item>
  )
}
