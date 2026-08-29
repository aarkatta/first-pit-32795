/**
 * Firestore hands back `Timestamp` objects on live reads and ISO strings on
 * replayed writes, so every date that crosses the wire needs the same coercion.
 * This module is the single implementation — page-local copies drifted apart
 * (some skipped the `Date` branch, some used `toMillis`, some fell back to
 * "now" on an unparseable value) and produced different labels for one document.
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    const converted = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Short human label, e.g. "Mar 7". Returns '' for a missing date. */
export function formatDueDate(date: Date | null): string {
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

/** Same label as `formatDueDate`, with an explicit placeholder for empty values. */
export function formatDateLabel(value: unknown, placeholder = 'No date'): string {
  return formatDueDate(toDate(value)) || placeholder;
}

/** Date with time, e.g. "Mar 7, 2:15 PM". */
export function formatDateTimeLabel(value: unknown, placeholder = 'No date'): string {
  const date = toDate(value);
  if (!date) return placeholder;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function localIso(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
}

/** `<input type="date">` needs a local-time yyyy-mm-dd, not the UTC slice of an ISO string. */
export function dateInputValue(value: unknown): string {
  const date = toDate(value);
  return date ? localIso(date).slice(0, 10) : '';
}

/** `<input type="datetime-local">` needs local-time yyyy-mm-ddThh:mm. */
export function dateTimeInputValue(value: unknown): string {
  const date = toDate(value);
  return date ? localIso(date).slice(0, 16) : '';
}

export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  // A bare yyyy-mm-dd parses as UTC midnight; anchor it to local time so it
  // round-trips with the local-time rendering in dateInputValue.
  const date = new Date(value.includes('T') ? value : `${value}T00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
