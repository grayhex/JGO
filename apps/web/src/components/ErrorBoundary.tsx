import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t as translateUI } from '../i18n';

/**
 * A page that fails to draw must not leave a blank screen: say so, keep what the server is doing untouched (a running game keeps running
 * and can be picked up again), and offer the way out. The details help a bug report.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('MGO UI error', error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <img src="/graphics/states/server-offline.svg" alt="" width={320} />
        <h1>{translateUI('Something went wrong on this page')}</h1>
        <p className="muted">{translateUI('Your games and saves are safe on the server, and a running game keeps running. Reload the page, or go back to the library.')}</p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => location.reload()}>{translateUI('Reload the page')}</button>
          <a className="btn" href="/">{translateUI('Back to the library')}</a>
        </div>
        <details className="more"><summary>{translateUI('Details for a bug report')}</summary><pre className="codeblock">{error.name}: {error.message}{'\n'}{(error.stack ?? '').split('\n').slice(1, 6).join('\n')}</pre></details>
      </div>
    );
  }
}
