import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { apiClient } from '@/api/client'

export function useBackendStatus() {
  const { setBackendStatus } = useAppStore()
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    async function checkHealth() {
      try {
        await apiClient.get('/health')
        setBackendStatus({ connected: true, lastCheck: new Date().toISOString() })
      } catch {
        setBackendStatus({ connected: false, lastCheck: new Date().toISOString() })
      }
    }

    checkHealth()
    intervalRef.current = setInterval(checkHealth, 10000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [setBackendStatus])
}
