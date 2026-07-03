import { Component } from "react";

// App-wide safety net: a render error in any page shows a readable message
// instead of blanking the whole SPA (there was no boundary before, so any throw
// = white page). Resets when you navigate (keyed on the current path in App).
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it in the console for debugging; no external reporting.
    console.error("Render error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="card" style={{ borderColor: "var(--err)" }}>
            <div className="text-sm font-semibold mb-2" style={{ color: "var(--err)" }}>
              Something went wrong on this page
            </div>
            <div className="text-xs mono" style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
              {String(this.state.error?.message || this.state.error)}
            </div>
            <button className="btn btn-primary mt-3" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
