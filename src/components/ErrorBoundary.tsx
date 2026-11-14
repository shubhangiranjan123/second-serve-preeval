import { Component, type ErrorInfo, type ReactNode } from 'react'

// Last line of defence: if any screen throws while rendering, show what
// happened and a way back, instead of a blank page.
type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[second-serve] screen crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash" role="alert">
        <h1>This screen hit an error.</h1>
        <p>Your saved listings are safe in this browser. Go back to the app, or reset the demo data if it keeps happening.</p>
        <code>{this.state.error.message}</code>
        <div className="crash-actions">
          <button
            className="btn btn-pink"
            onClick={() => {
              this.setState({ error: null })
              window.location.hash = 'home'
            }}
          >
            Back to the app
          </button>
          <button
            className="btn btn-ghost-light"
            onClick={() => {
              try {
                localStorage.removeItem('second-serve-preeval-v2')
              } catch {
                /* storage blocked */
              }
              window.location.reload()
            }}
          >
            Reset demo data
          </button>
        </div>
      </div>
    )
  }
}
