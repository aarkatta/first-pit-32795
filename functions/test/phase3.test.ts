import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES, detectContentMismatch, goalOperationVersion, nextGoalMutationVersion, nextTaskMutationVersion, occurrences, taskNotificationDedupeKey, taskOperationVersion, validateContentType, validateRecurrence, validateTaskInput } from '../src/phase3.js';

describe('Phase 3 command validation', () => {
  it('keeps tasks bounded and explicit', () => {
    expect(validateTaskInput({ title: 'Build a drivetrain', priority: 'high', status: 'todo' })).toMatchObject({ title: 'Build a drivetrain', priority: 'high', status: 'todo', checklist: [] });
    expect(() => validateTaskInput({ title: '' })).toThrow(/Task title/);
    expect(() => validateTaskInput({ title: 'x', checklist: Array.from({ length: 101 }, (_, index) => ({ id: String(index), label: 'x' })) })).toThrow(/100/);
  });

  it('requires bounded recurrence and materializes deterministic occurrences', () => {
    const recurrence = validateRecurrence({ frequency: 'weekly', interval: 2, count: 3 });
    expect(recurrence).toMatchObject({ frequency: 'weekly', interval: 2, count: 3 });
    expect(occurrences(new Date('2026-01-05T10:00:00.000Z'), recurrence)).toHaveLength(3);
    expect(() => validateRecurrence({ frequency: 'weekly' })).toThrow(/count or end/);
    expect(() => validateRecurrence({ frequency: 'weekly', count: 53 })).toThrow(/1 to 52/);
    expect(validateRecurrence({ frequency: 'monthly', until: Timestamp.fromDate(new Date('2026-04-01T00:00:00.000Z')) })).toBeTruthy();
  });

  it('keeps uploads allowlisted and capped', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(validateContentType(' text/plain ')).toBe('text/plain');
    expect(validateContentType('APPLICATION/PDF')).toBe('application/pdf');
    expect(() => validateContentType('text')).toThrow(/Content type/);
    expect(() => validateContentType('text/plain/extra')).toThrow(/Content type/);
    expect(ALLOWED_FILE_TYPES.has('application/pdf')).toBe(true);
    expect(ALLOWED_FILE_TYPES.has('application/x-executable')).toBe(false);
  });

  it('detects stale task saves and gives separate committed versions separate notification identities', () => {
    expect(nextTaskMutationVersion(4, 4)).toBe(5);
    expect(() => nextTaskMutationVersion(5, 4)).toThrow(/changed while you were editing/i);
    expect(taskNotificationDedupeKey('task-1', 5)).toBe('task:task-1:changed:v5');
    expect(taskNotificationDedupeKey('task-1', 6)).not.toBe(taskNotificationDedupeKey('task-1', 5));
  });

  it('replays only the matching task update operation outcome', () => {
    const receipt = { teamId: 'team-1', createdBy: 'coach-1', kind: 'task.update', taskId: 'task-1', version: 3 };
    expect(taskOperationVersion(receipt, { teamId: 'team-1', actorUserId: 'coach-1', taskId: 'task-1' })).toBe(3);
    expect(() => taskOperationVersion(receipt, { teamId: 'team-1', actorUserId: 'coach-2', taskId: 'task-1' })).toThrow(/different task update/i);
  });

  it('detects a stale goal save and treats a pre-version goal as version 1', () => {
    // Goals carried no version at all, so two coaches editing the same goal
    // silently overwrote each other. Existing goals must keep working.
    expect(nextGoalMutationVersion(2, 2)).toBe(3);
    expect(nextGoalMutationVersion(undefined, 1)).toBe(2);
    expect(nextGoalMutationVersion(null, 1)).toBe(2);
    expect(() => nextGoalMutationVersion(3, 2)).toThrow(/goal changed while you were editing/i);
    expect(() => nextGoalMutationVersion(1, 0)).toThrow(/positive integer/i);
    expect(() => nextGoalMutationVersion(1, 'two')).toThrow(/positive integer/i);
  });

  it('replays only the matching goal update operation outcome', () => {
    const receipt = { teamId: 'team-1', createdBy: 'coach-1', kind: 'goal.update', goalId: 'goal-1', version: 4 };
    expect(goalOperationVersion(receipt, { teamId: 'team-1', actorUserId: 'coach-1', goalId: 'goal-1' })).toBe(4);
    expect(() => goalOperationVersion(receipt, { teamId: 'team-2', actorUserId: 'coach-1', goalId: 'goal-1' })).toThrow(/different goal update/i);
    expect(() => goalOperationVersion(receipt, { teamId: 'team-1', actorUserId: 'coach-2', goalId: 'goal-1' })).toThrow(/different goal update/i);
    expect(() => goalOperationVersion(receipt, { teamId: 'team-1', actorUserId: 'coach-1', goalId: 'goal-2' })).toThrow(/different goal update/i);
    // A task receipt must never be replayed as a goal receipt.
    expect(() => goalOperationVersion({ ...receipt, kind: 'task.update' }, { teamId: 'team-1', actorUserId: 'coach-1', goalId: 'goal-1' })).toThrow(/different goal update/i);
  });

  describe('uploaded file content inspection', () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    const text = (value: string) => new TextEncoder().encode(value);

    it('accepts each permitted type when the bytes match the declared type', () => {
      expect(detectContentMismatch('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBeNull();
      expect(detectContentMismatch('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
      expect(detectContentMismatch('image/webp', bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50))).toBeNull();
      expect(detectContentMismatch('application/pdf', text('%PDF-1.7\n'))).toBeNull();
      expect(detectContentMismatch('application/zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
      expect(detectContentMismatch('text/plain', text('practice notes\nrun 3: 315 pts\n'))).toBeNull();
      expect(detectContentMismatch('text/csv', text('mission,points\nM04,25\n'))).toBeNull();
    });

    it('rejects a file whose bytes contradict the type the client declared', () => {
      // The whole point: the browser picks contentType and storage.rules only
      // compares it against itself, so a disguised binary must be caught here.
      expect(detectContentMismatch('text/plain', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toMatch(/plain text/i);
      expect(detectContentMismatch('image/png', text('not really an image'))).toMatch(/PNG/i);
      expect(detectContentMismatch('application/pdf', bytes(0x50, 0x4b, 0x03, 0x04))).toMatch(/PDF/i);
      expect(detectContentMismatch('application/zip', text('%PDF-1.7'))).toMatch(/ZIP/i);
      expect(detectContentMismatch('image/jpeg', bytes(0x89, 0x50, 0x4e, 0x47))).toMatch(/JPEG/i);
      // A RIFF container that is not WebP (e.g. a WAV) must not pass as WebP.
      expect(detectContentMismatch('image/webp', bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45))).toMatch(/WebP/i);
    });

    it('treats NUL bytes and control characters as binary, not text', () => {
      expect(detectContentMismatch('text/plain', bytes(0x68, 0x00, 0x69))).toMatch(/plain text/i);
      expect(detectContentMismatch('text/csv', bytes(0x01, 0x02, 0x03))).toMatch(/plain text/i);
      // Tabs, newlines and a UTF-8 BOM are ordinary in real .txt and .csv files.
      expect(detectContentMismatch('text/plain', bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toBeNull();
      expect(detectContentMismatch('text/csv', text('a\tb\r\nc\td\n'))).toBeNull();
      expect(detectContentMismatch('text/plain', new Uint8Array())).toBeNull();
    });

    it('rejects any type outside the allowlist', () => {
      expect(detectContentMismatch('application/x-msdownload', bytes(0x4d, 0x5a))).toMatch(/unsupported/i);
      expect(detectContentMismatch('image/svg+xml', text('<svg />'))).toMatch(/unsupported/i);
    });
  });
});
