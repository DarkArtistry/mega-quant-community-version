import { apiClient } from './client'

export const securityApi = {
  checkSetup: () =>
    apiClient.get<{ success: boolean; isSetupComplete: boolean }>('/api/security/setup-status'),

  setup: (password: string) =>
    apiClient.post<{ success: boolean }>('/api/security/setup', { password }),

  unlock: (password: string) =>
    apiClient.post<{ success: boolean; keySalt?: string }>('/api/security/unlock', { password }),

  lock: () =>
    apiClient.post<{ success: boolean }>('/api/security/lock'),

  validatePassword: (password: string) =>
    apiClient.post<{ success: boolean; valid: boolean; errors: string[] }>(
      '/api/security/validate-password',
      { password }
    ),

  reset: (confirmReset: string) =>
    apiClient.post<{ success: boolean }>('/api/security/reset', { confirmReset }),
}
