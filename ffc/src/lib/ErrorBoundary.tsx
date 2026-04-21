import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* TODO S017 — wire to telemetry (Supabase `error_reports` or third-party).
     * Keeping console for now so S016 deploys show errors in prod DevTools. */
    // eslint-disable-next-line no-console
    console.error('[FFC ErrorBoundary]', error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="app-error" role="alert">
          <h1>Something went wrong.</h1>
          <p>An unexpected error occurred. You can try reloading the screen.</p>
          <pre>{this.state.error.message}</pre>
          <button
            type="button"
            onClick={this.reset}
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: 'var(--accent)',
              color: 'var(--accent-contrast)',
              borderRadius: 8,
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
