import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.response?.status, error.message)
    return Promise.reject(error)
  }
)

/** Derive the WebSocket URL from the API base URL */
export function getWebSocketUrl(): string {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws')
  return `${wsBase}/ws/live-data`
}
