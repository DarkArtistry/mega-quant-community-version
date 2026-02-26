import { apiClient } from './client'

// --- Types ---

export interface RunnerStatus {
  state: 'idle' | 'initializing' | 'running' | 'paused' | 'stopped' | 'error'
  strategyId: string
  startedAt?: string
  stoppedAt?: string
  executionCount: number
  errorCount: number
  lastHeartbeat?: string
}

export interface RunnerLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

// --- API Client ---

export const strategyRunnerApi = {
  /** Start a strategy runner */
  start: (strategyId: string) =>
    apiClient.post<{ success: boolean; status: RunnerStatus }>(
      `/api/strategy-runner/${strategyId}/start`
    ),

  /** Stop a strategy runner */
  stop: (strategyId: string) =>
    apiClient.post<{ success: boolean; status: RunnerStatus }>(
      `/api/strategy-runner/${strategyId}/stop`
    ),

  /** Pause a strategy runner */
  pause: (strategyId: string) =>
    apiClient.post<{ success: boolean; status: RunnerStatus }>(
      `/api/strategy-runner/${strategyId}/pause`
    ),

  /** Resume a paused strategy runner */
  resume: (strategyId: string) =>
    apiClient.post<{ success: boolean; status: RunnerStatus }>(
      `/api/strategy-runner/${strategyId}/resume`
    ),

  /** Get runner status and optionally logs since a timestamp */
  status: (strategyId: string, params?: { since?: string; limit?: number }) =>
    apiClient.get<{ success: boolean; status: RunnerStatus; logs: RunnerLogEntry[] }>(
      `/api/strategy-runner/${strategyId}/status`,
      { params }
    ),

  /** List all active runners */
  active: () =>
    apiClient.get<{ success: boolean; runners: RunnerStatus[]; count: number }>(
      '/api/strategy-runner/active'
    ),

  /** Get paginated persistent logs */
  logs: (strategyId: string, params?: { limit?: number; before?: string }) =>
    apiClient.get<{
      success: boolean
      logs: Array<{ id: number; level: string; message: string; timestamp: string; run_id: string }>
      hasMore: boolean
      oldestId: number | null
    }>(`/api/strategy-runner/${strategyId}/logs`, { params }),
}
