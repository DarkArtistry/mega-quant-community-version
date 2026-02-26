import { create } from 'zustand'

// --- Types ---

export interface LiveTrade {
  executionId: string
  strategyId: string
  side: string
  symbol: string
  quantity: string
  price: string
  timestamp: string
}

export interface LivePrice {
  price: number
  timestamp: number
}

interface LiveDataState {
  recentTrades: LiveTrade[]
  latestPrices: Record<string, LivePrice>
  isConnected: boolean

  addTrade: (trade: LiveTrade) => void
  updatePrice: (symbol: string, price: number, timestamp: number) => void
  setConnected: (connected: boolean) => void
  clear: () => void
}

const MAX_RECENT_TRADES = 50

export const useLiveDataStore = create<LiveDataState>((set) => ({
  recentTrades: [],
  latestPrices: {},
  isConnected: false,

  addTrade: (trade) =>
    set((state) => ({
      recentTrades: [trade, ...state.recentTrades].slice(0, MAX_RECENT_TRADES),
    })),

  updatePrice: (symbol, price, timestamp) =>
    set((state) => ({
      latestPrices: {
        ...state.latestPrices,
        [symbol]: { price, timestamp },
      },
    })),

  setConnected: (connected) => set({ isConnected: connected }),

  clear: () =>
    set({
      recentTrades: [],
      latestPrices: {},
    }),
}))
