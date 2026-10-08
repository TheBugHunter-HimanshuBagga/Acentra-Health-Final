import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** quiet: render nothing on failure (used around optional widgets such as the chat) instead of a recovery card */
  quiet?: boolean
}

/** A rendering error in one part of the page must never blank the whole screen. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error.message, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.quiet) return null
    return (
      <div role="alert" className="mx-auto mt-24 w-full max-w-md space-y-4 rounded-2xl border bg-card p-8 text-center">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="text-xl font-semibold">This part of the page could not be shown.</h1>
        <p className="text-sm text-muted-foreground">Your work is saved. Reload to continue; if it happens again, tell the team what you were doing.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className="rounded-full border px-4 py-2 text-sm" onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      </div>
    )
  }
}
