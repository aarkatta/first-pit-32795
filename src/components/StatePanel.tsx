type StateVariant = 'loading' | 'empty' | 'error' | 'permission' | 'offline';

type StatePanelProps = {
  variant: StateVariant;
  title: string;
  message: string;
  actionLabel?: string;
};

const variantLabels: Record<StateVariant, string> = {
  loading: 'Loading',
  empty: 'Empty',
  error: 'Error',
  permission: 'Permission denied',
  offline: 'Offline'
};

export function StatePanel({ variant, title, message, actionLabel }: StatePanelProps) {
  return (
    <article className={`state-panel state-panel--${variant}`}>
      <div className="state-panel__header">
        <span className="eyebrow">{variantLabels[variant]}</span>
        <h3>{title}</h3>
      </div>
      <p>{message}</p>
      {actionLabel ? (
        <button type="button" className="button button--ghost">
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}
