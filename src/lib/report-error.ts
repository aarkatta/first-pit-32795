/**
 * Dependency-free error reporting seam.
 *
 * Before this existed the only sink for a crash was `console.error` inside
 * `AppErrorBoundary`, and rejected promises from the `*-service.ts` callables
 * disappeared entirely. Everything now funnels through `reportError`, which
 * hands a structured record to a pluggable sink. The default sink writes to the
 * console; a real backend (a callable, an HTTP endpoint, a vendor SDK) can be
 * installed at startup with `setErrorSink` without touching call sites.
 *
 * Safety: reports are metadata only. First Pit handles minors' data, so message
 * bodies, file contents, and profile fields must never leave the app inside a
 * crash report. `redact` strips the two things that most often leak into an
 * error string — email addresses and long opaque tokens — and every field is
 * truncated. A sink that forwards reports off-device is a privacy decision and
 * needs an explicit product/safety review before it is installed.
 */

export type ErrorReportSource = 'react-error-boundary' | 'unhandled-rejection' | 'window-error' | 'manual';

export type ErrorReport = {
  source: ErrorReportSource;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  /** Path only — query strings and hashes can carry identifiers. */
  path?: string;
  timestamp: string;
};

export type ErrorSink = (report: ErrorReport) => void;

const MAX_MESSAGE_LENGTH = 300;
const MAX_STACK_LENGTH = 2000;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{24,}\b/g;

export function redact(value: string): string {
  return value.replace(EMAIL_PATTERN, '[redacted-email]').replace(LONG_TOKEN_PATTERN, '[redacted-token]');
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return redact(value).slice(0, maxLength);
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message || '', stack: error.stack };
  }
  if (typeof error === 'string') return { name: 'NonError', message: error };
  return { name: 'NonError', message: safeStringify(error) };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const consoleErrorSink: ErrorSink = (report) => {
  console.error('[first-pit] error report', report);
};

let sink: ErrorSink = consoleErrorSink;

/** Install a different sink. Returns the previous one so callers can restore it. */
export function setErrorSink(next: ErrorSink): ErrorSink {
  const previous = sink;
  sink = next;
  return previous;
}

export function resetErrorSink(): void {
  sink = consoleErrorSink;
}

export function buildErrorReport(
  error: unknown,
  context: { source: ErrorReportSource; componentStack?: string } = { source: 'manual' }
): ErrorReport {
  const { name, message, stack } = describe(error);
  return {
    source: context.source,
    name,
    message: clean(message, MAX_MESSAGE_LENGTH) ?? '',
    stack: clean(stack, MAX_STACK_LENGTH),
    componentStack: clean(context.componentStack, MAX_STACK_LENGTH),
    path: typeof window === 'undefined' ? undefined : window.location?.pathname,
    timestamp: new Date().toISOString()
  };
}

/** Report an error. Never throws: a broken sink must not break the app. */
export function reportError(
  error: unknown,
  context: { source: ErrorReportSource; componentStack?: string } = { source: 'manual' }
): ErrorReport {
  const report = buildErrorReport(error, context);
  try {
    sink(report);
  } catch {
    // A failing sink is not worth a second failure.
  }
  return report;
}

let unregisterGlobalHandlers: (() => void) | null = null;

/**
 * Route `unhandledrejection` and uncaught `error` events into the sink. Rejected
 * promises are the common case here: the Firestore/callable wrappers in
 * `src/lib/*-service.ts` reject, and a component that forgets a `.catch` would
 * otherwise fail silently. Calling this twice is a no-op.
 */
export function registerGlobalErrorHandlers(target: Window = window): () => void {
  if (unregisterGlobalHandlers) return unregisterGlobalHandlers;

  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, { source: 'unhandled-rejection' });
  };
  const onError = (event: ErrorEvent) => {
    reportError(event.error ?? event.message, { source: 'window-error' });
  };

  target.addEventListener('unhandledrejection', onRejection);
  target.addEventListener('error', onError);

  unregisterGlobalHandlers = () => {
    target.removeEventListener('unhandledrejection', onRejection);
    target.removeEventListener('error', onError);
    unregisterGlobalHandlers = null;
  };
  return unregisterGlobalHandlers;
}
