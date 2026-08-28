import { useEffect, useRef } from 'react';

export type StateVariant = 'loading' | 'empty' | 'error' | 'permission' | 'offline';

type StatePanelProps = {
  variant: StateVariant;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  autoFocus?: boolean;
};

const variantLabels: Record<StateVariant, string> = {
  loading: 'Loading',
  empty: 'Empty',
  error: 'Error',
  permission: 'Permission denied',
  offline: 'Offline'
};

export function StatePanel({ variant, title, message, actionLabel, onAction, autoFocus = false }: StatePanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [autoFocus, message, title]);

  const isAlert = variant === 'error' || variant === 'permission' || variant === 'offline';
  return (
    <article
      className={`state-panel feature-panel state-panel--${variant}`}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <div className="state-panel__header">
        <span className="eyebrow">{variantLabels[variant].toUpperCase()}</span>
        <h3 ref={headingRef} tabIndex={autoFocus ? -1 : undefined}>{title}</h3>
      </div>
      <p>{message}</p>
      {actionLabel && onAction ? (
        <button type="button" className="button button--ghost" onClick={onAction}>
          {actionLabel}
        </button>
      ) : actionLabel ? (
        <p className="state-panel__action-example">
          Example action: <strong>{actionLabel}</strong> (not active in this example)
        </p>
      ) : null}
    </article>
  );
}
