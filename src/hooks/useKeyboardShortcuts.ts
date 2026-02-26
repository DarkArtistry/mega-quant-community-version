import { useEffect } from 'react'

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  handler: () => void
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta ? e.metaKey : !e.metaKey
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : !e.ctrlKey
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey

        if (e.key.toLowerCase() === shortcut.key.toLowerCase() && metaMatch && ctrlMatch && shiftMatch) {
          e.preventDefault()
          shortcut.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
