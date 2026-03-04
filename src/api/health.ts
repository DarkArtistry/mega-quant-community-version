import { apiClient } from './client'

export interface ServiceTestResult {
  service: string
  status: 'ok' | 'error' | 'not_configured'
  latencyMs: number
  message: string
  provider?: string
  blockNumber?: number
  price?: number
}

export interface HealthCheckResponse {
  success: boolean
  results: ServiceTestResult[]
  timestamp: number
}

export const healthApi = {
  testServices: () =>
    apiClient.get<HealthCheckResponse>('/api/health/test-services'),
}
