import { create } from 'zustand'
import type { Strategy, WorkerState } from '@/types'

interface StrategyState {
  strategies: Strategy[]
  selectedStrategyId: string | null
  workerStates: Map<string, WorkerState>

  setStrategies: (strategies: Strategy[]) => void
  setSelectedStrategy: (id: string | null) => void
  updateStrategy: (id: string, updates: Partial<Strategy>) => void
  setWorkerState: (strategyId: string, state: WorkerState) => void
  removeWorkerState: (strategyId: string) => void
}

export const useStrategyStore = create<StrategyState>((set) => ({
  strategies: [],
  selectedStrategyId: null,
  workerStates: new Map(),

  setStrategies: (strategies) => set({ strategies }),

  setSelectedStrategy: (id) => set({ selectedStrategyId: id }),

  updateStrategy: (id, updates) =>
    set((state) => ({
      strategies: state.strategies.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  setWorkerState: (strategyId, workerState) =>
    set((state) => {
      const newMap = new Map(state.workerStates)
      newMap.set(strategyId, workerState)
      return { workerStates: newMap }
    }),

  removeWorkerState: (strategyId) =>
    set((state) => {
      const newMap = new Map(state.workerStates)
      newMap.delete(strategyId)
      return { workerStates: newMap }
    }),
}))
