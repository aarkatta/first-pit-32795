import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildErrorReport,
  redact,
  registerGlobalErrorHandlers,
  reportError,
  resetErrorSink,
  setErrorSink
} from './report-error';

afterEach(() => {
  resetErrorSink();
  vi.restoreAllMocks();
});

describe('redact', () => {
  it('removes email addresses and long opaque tokens', () => {
    const redacted = redact('coach coach.smith+fll@example.org failed with tok_0123456789abcdef0123456789abcdef');
    expect(redacted).not.toContain('example.org');
    expect(redacted).toContain('[redacted-email]');
    expect(redacted).toContain('[redacted-token]');
  });
});

describe('buildErrorReport', () => {
  it('describes an Error with a source and a timestamp', () => {
    const report = buildErrorReport(new TypeError('bad shape'), { source: 'react-error-boundary' });
    expect(report.name).toBe('TypeError');
    expect(report.message).toBe('bad shape');
    expect(report.source).toBe('react-error-boundary');
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it('handles thrown strings and non-error values', () => {
    expect(buildErrorReport('plain failure').name).toBe('NonError');
    expect(buildErrorReport({ code: 'permission-denied' }).message).toContain('permission-denied');
  });

  it('truncates long messages', () => {
    const report = buildErrorReport(new Error('render step failed '.repeat(60)));
    expect(report.message.length).toBe(300);
  });
});

describe('reportError', () => {
  it('sends the report to the installed sink', () => {
    const sink = vi.fn();
    setErrorSink(sink);
    reportError(new Error('boom'), { source: 'manual' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].message).toBe('boom');
  });

  it('swallows a failing sink', () => {
    setErrorSink(() => {
      throw new Error('sink is down');
    });
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('defaults to structured console output', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError(new Error('boom'));
    expect(spy).toHaveBeenCalledWith('[first-pit] error report', expect.objectContaining({ name: 'Error' }));
  });
});

describe('registerGlobalErrorHandlers', () => {
  it('reports unhandled rejections and is idempotent', () => {
    const sink = vi.fn();
    setErrorSink(sink);

    const unregister = registerGlobalErrorHandlers(window);
    expect(registerGlobalErrorHandlers(window)).toBe(unregister);

    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('unawaited callable');
    window.dispatchEvent(event);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0].source).toBe('unhandled-rejection');

    unregister();
    window.dispatchEvent(event);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
