import React from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

type ErrorBoundaryState = {
  error?: Error
}

type ErrorBoundaryProps = {
  children: ReactNode
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare readonly props: Readonly<ErrorBoundaryProps>

  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Claude Desktop renderer crashed', error, info.componentStack)
  }

  reload(): void {
    localStorage.removeItem('claude-desktop-render-crash-test')
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="fatal-error-shell" role="alert">
          <section className="fatal-error-card">
            <div className="app-kicker">Claude Code Desktop</div>
            <h1>Renderer recovered from an error</h1>
            <p>{this.state.error.message || 'The desktop renderer failed while drawing the workspace.'}</p>
            <button className="send-button" onClick={() => this.reload()}>
              Reload desktop
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

function RendererCrashProbe(): null {
  if (localStorage.getItem('claude-desktop-render-crash-test') === '1') {
    throw new Error('Desktop renderer crash test')
  }
  return null
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing root element')
}

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RendererCrashProbe />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
