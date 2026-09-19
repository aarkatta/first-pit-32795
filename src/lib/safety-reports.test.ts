import { describe, expect, it } from 'vitest';
import { REPORT_REASONS, reportNote, reportReasonLabel, reportedQuestionId } from './safety-reports';

describe('safety report helpers', () => {
  it('labels chosen reasons, legacy reports and unknown codes', () => {
    expect(reportReasonLabel('unkind')).toBe('Unkind or bullying');
    expect(reportReasonLabel('knowledge-content')).toBe('No reason given');
    expect(reportReasonLabel('custom-code')).toBe('custom-code');
  });

  it('keeps reason codes within the server limit', () => {
    for (const reason of REPORT_REASONS) expect(reason.code.length).toBeLessThanOrEqual(64);
  });

  it("shows only the reporter's own note", () => {
    expect(reportNote('  Rude joke ')).toBe('Rude joke');
    expect(reportNote('Reported from Questions.')).toBeNull();
    expect(reportNote('   ')).toBeNull();
    expect(reportNote(undefined)).toBeNull();
  });

  it('finds the reported question id', () => {
    expect(reportedQuestionId('questions/q-1')).toBe('q-1');
    expect(reportedQuestionId('answers/a-1')).toBeNull();
    expect(reportedQuestionId('questions/q-1/extra')).toBeNull();
    expect(reportedQuestionId(undefined)).toBeNull();
  });
});
