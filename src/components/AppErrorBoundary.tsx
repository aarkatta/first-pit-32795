import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StatePanel } from './StatePanel';
import { reportError } from '../lib/report-error';

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { error: Error | null };

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // reportError redacts and truncates before handing the record to the sink, so
    // observability metadata stays free of user content, file contents, and message bodies.
    reportError(error, {
      source: 'react-error-boundary',
      componentStack: info.componentStack ?? undefined
    });
  }

  render() {
    if (this.state.error) {
      return (
        <StatePanel
          variant="error"
          title="First Pit could not render this screen"
          message="Try reloading the screen. If the problem continues, share the time and screen name with a coach or administrator."
          actionLabel="Reload"
          onAction={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
