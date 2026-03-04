import { create } from 'zustand'
import type { Theme, AppScreen, BackendStatus } from '@/types'

export type NetworkFilterValue = 'all' | 'mainnet' | 'testnet'

interface AppState {
  // Auth
  isUnlocked: boolean
  isSetupComplete: boolean | null
  sessionPassword: string | null

  // Theme
  theme: Theme

  // Navigation
  activeScreen: AppScreen

  // Backend
  backendStatus: BackendStatus

  // Network filter
  networkFilter: NetworkFilterValue

  // Actions
  setUnlocked: (unlocked: boolean) => void
  setSetupComplete: (complete: boolean) => void
  setSessionPassword: (password: string | null) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setActiveScreen: (screen: AppScreen) => void
  setBackendStatus: (status: Partial<BackendStatus>) => void
  setNetworkFilter: (filter: NetworkFilterValue) => void
  lock: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  isUnlocked: false,
  isSetupComplete: null,
  sessionPassword: null,
  theme: 'dark',
  activeScreen: 'dashboard',
  backendStatus: {
    connected: false,
    wsConnected: false,
    lastCheck: '',
  },
  networkFilter: 'all',

  setUnlocked: (unlocked) => set({ isUnlocked: unlocked }),
  setSetupComplete: (complete) => set({ isSetupComplete: complete }),
  setSessionPassword: (password) => set({ sessionPassword: password }),

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', newTheme)
    set({ theme: newTheme })
  },

  setActiveScreen: (screen) => set({ activeScreen: screen }),

  setBackendStatus: (status) =>
    set((state) => ({
      backendStatus: { ...state.backendStatus, ...status },
    })),

  setNetworkFilter: (filter) => set({ networkFilter: filter }),

  lock: () =>
    set({
      isUnlocked: false,
      sessionPassword: null,
    }),
}))
