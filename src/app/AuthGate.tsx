import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { securityApi } from '@/api/security'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Lock, Eye, EyeOff, RotateCcw } from 'lucide-react'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isUnlocked, isSetupComplete, setUnlocked, setSetupComplete, setSessionPassword } =
    useAppStore()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [showReset, setShowReset] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    checkSetupStatus()
  }, [])

  async function checkSetupStatus() {
    try {
      const { data } = await securityApi.checkSetup()
      setSetupComplete(data.isSetupComplete)
    } catch {
      // Backend not running yet -- will retry
      setSetupComplete(false)
    } finally {
      setChecking(false)
    }
  }

  async function handleSetup() {
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError('')
    try {
      const { data } = await securityApi.setup(password)
      if (data.success) {
        setSetupComplete(true)
        setSessionPassword(password)
        setUnlocked(true)
      } else {
        setError('Setup failed')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlock() {
    setLoading(true)
    setError('')
    try {
      const { data } = await securityApi.unlock(password)
      if (data.success) {
        setSessionPassword(password)
        setUnlocked(true)
      } else {
        setError('Invalid password')
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Unlock failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (resetConfirm !== 'DELETE') return
    setResetting(true)
    try {
      await securityApi.reset('DELETE_ALL_DATA')
      setShowReset(false)
      setResetConfirm('')
      setPassword('')
      setError('')
      setSetupComplete(false)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  async function handleRestore() {
    if (!window.electronAPI?.restoreDatabase) return
    await window.electronAPI.restoreDatabase()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      if (isSetupComplete) {
        handleUnlock()
      } else if (password && confirmPassword) {
        handleSetup()
      }
    }
  }

  if (isUnlocked) return <>{children}</>

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-text-tertiary text-sm">Connecting to backend...</div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="w-full max-w-[360px] p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-surface border border-border mb-4">
            <span className="text-2xl font-bold text-accent leading-none" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>M</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">MEGA QUANT</h1>
          <p className="text-xs text-text-tertiary mt-1">
            {isSetupComplete ? 'Enter password to unlock' : 'Create a master password'}
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3" onKeyDown={handleKeyDown}>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Master password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {!isSetupComplete && (
            <>
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <ul className="text-2xs text-text-tertiary space-y-0.5 pl-3">
                <li>8+ characters</li>
                <li>Uppercase and lowercase letters</li>
                <li>At least one number</li>
                <li>At least one special character</li>
              </ul>
            </>
          )}

          {error && (
            <p className="text-xs text-negative">{error}</p>
          )}

          <Button
            className="w-full"
            onClick={isSetupComplete ? handleUnlock : handleSetup}
            disabled={loading || !password || (!isSetupComplete && !confirmPassword)}
          >
            <Lock className="w-3.5 h-3.5" />
            {loading ? 'Please wait...' : isSetupComplete ? 'Unlock' : 'Create Vault'}
          </Button>

          {/* Forgot password & restore (only on unlock screen) */}
          {isSetupComplete && !showReset && (
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setShowReset(true)}
                className="text-2xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Forgot password?
              </button>
              {window.electronAPI?.restoreDatabase && (
                <button
                  type="button"
                  onClick={handleRestore}
                  className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore from Backup
                </button>
              )}
            </div>
          )}

          {/* Reset confirmation */}
          {showReset && (
            <div className="rounded border border-negative/30 bg-negative/5 p-3 space-y-2">
              <p className="text-2xs text-negative font-medium">
                This will permanently delete all data and cannot be undone.
              </p>
              <p className="text-2xs text-text-tertiary">
                Type <span className="font-mono font-semibold text-text-secondary">DELETE</span> to confirm.
              </p>
              <Input
                placeholder="Type DELETE"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                className="h-7 text-xs"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => { setShowReset(false); setResetConfirm('') }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={handleReset}
                  disabled={resetConfirm !== 'DELETE' || resetting}
                >
                  {resetting ? 'Resetting...' : 'Reset App'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="text-2xs text-text-tertiary text-center mt-6">
          All keys encrypted with AES-256-GCM
        </p>
      </div>
    </div>
  )
}
