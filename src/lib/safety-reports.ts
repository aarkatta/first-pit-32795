/**
 * Reasons a member can give when reporting team content. The code is what the
 * report stores (`reasonCode`, 64 characters at most on the server); the label
 * is what reporters and coaches read.
 */
export const REPORT_REASONS = [
  { code: 'unkind', label: 'Unkind or bullying' },
  { code: 'inappropriate', label: 'Not appropriate for kids' },
  { code: 'personal-info', label: 'Shares personal information' },
  { code: 'other', label: 'Something else' }
] as const;

export type ReportReasonCode = (typeof REPORT_REASONS)[number]['code'];

/** Longest optional note a reporter can add; the server accepts up to 2000. */
export const REPORT_NOTE_MAX = 500;

/** Reports filed before reasons existed carry this code and no chosen reason. */
const LEGACY_REASONS: Record<string, string> = {
  'knowledge-content': 'No reason given'
};

export function reportReasonLabel(code: string): string {
  return REPORT_REASONS.find((reason) => reason.code === code)?.label ?? LEGACY_REASONS[code] ?? code;
}

/** The legacy Report button stored this fixed note instead of the reporter's words. */
const LEGACY_NOTES = new Set(['Reported from Questions.']);

export function reportNote(description: string | undefined): string | null {
  const note = description?.trim();
  return note && !LEGACY_NOTES.has(note) ? note : null;
}

/** The reported question's id, when the report points at a team question. */
export function reportedQuestionId(targetResource: string | undefined): string | null {
  const match = /^questions\/([^/]+)$/.exec(targetResource ?? '');
  return match ? match[1] : null;
}
