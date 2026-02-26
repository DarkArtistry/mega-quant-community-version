import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error)
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6">
          <AlertTriangle className="w-10 h-10 text-negative mb-4" />
          <h2 className="text-sm font-semibold mb-1">Something went wrong</h2>
          <p className="text-xs text-text-tertiary mb-4 max-w-md text-center">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={this.handleReset}>
              Try Again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                this.handleReset()
                window.location.reload()
              }}
            >
              Reload Page
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
