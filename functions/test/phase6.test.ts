import { describe, expect, it } from 'vitest';
import { buildScoreCsv, calculateScoreTotal, scoreOperationSessionId, scoreResponseMetadata, summarizeScores, validateScoreDefinition } from '../src/phase6.js';

describe('Phase 6 deterministic scoring', () => {
  it('calculates mission points minus deductions and never returns a negative total', () => {
    expect(calculateScoreTotal([{ missionId: 'm1', points: 8, completed: true }, { missionId: 'm2', points: 2, completed: false }], [{ deductionId: 'd1', points: 5 }])).toBe(5);
    expect(calculateScoreTotal([{ missionId: 'm1', points: 1, completed: false }], [{ deductionId: 'd1', points: 9 }])).toBe(0);
  });

  it('summarizes totals, mission completion, and practice/match trends deterministically', () => {
    const result = summarizeScores([
      { scoreType: 'practice', totalPoints: 10, missions: [{ missionId: 'm1', points: 10, completed: true }] },
      { scoreType: 'match', totalPoints: 6, missions: [{ missionId: 'm1', points: 6, completed: false }] }
    ]);
    expect(result).toMatchObject({ count: 2, total: 16, average: 8, best: 10, completionRate: 0.5 });
    expect(result.sessionTypeTrends).toEqual({ practice: { count: 1, totalPoints: 10 }, match: { count: 1, totalPoints: 6 } });
    expect(result.missionTrends.m1).toEqual({ attempts: 2, completed: 1, points: 16 });
  });

  it('validates team-defined source metadata and bounded mission definitions', () => {
    expect(validateScoreDefinition({ title: 'Robot game', season: '2026-2027', missions: [{ id: 'm1', name: 'Mission 1', maxPoints: 10 }], deductions: [] })).toMatchObject({ sourceType: 'team-defined', sourceLabel: 'Team-defined scoring' });
    expect(() => validateScoreDefinition({ title: 'Bad', season: '2026', missions: [{ id: 'm1', name: 'Mission 1', maxPoints: 1 }, { id: 'm1', name: 'Duplicate', maxPoints: 1 }] })).toThrow('IDs must be unique');
  });

  it('escapes CSV quotes, newlines, and formula-leading values', () => {
    const csv = buildScoreCsv([{ sessionDate: '2026-08-09T12:00:00.000Z', scoreType: 'practice', title: 'Run', totalPoints: 4, participantUserIds: ['student-1'], notes: '=SUM(A1)', robotProgramContext: 'line\nnext' }]);
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain('"line\nnext"');
  });

  it('separates the 50-record history page from the bounded statistics/export scope', () => {
    expect(scoreResponseMetadata(50, false)).toEqual({ historyTruncated: false, statisticsTruncated: false, statisticsLimit: 500 });
    expect(scoreResponseMetadata(51, false)).toEqual({ historyTruncated: true, statisticsTruncated: false, statisticsLimit: 500 });
    expect(scoreResponseMetadata(500, true)).toEqual({ historyTruncated: true, statisticsTruncated: true, statisticsLimit: 500 });
  });

  it('returns the stored score session only for the receipt owner, team, and operation kind', () => {
    const receipt = { teamId: 'team-1', createdBy: 'student-1', kind: 'score.session.create', sessionId: 'session-stored' };
    expect(scoreOperationSessionId(receipt, { teamId: 'team-1', actorUserId: 'student-1' })).toBe('session-stored');
    expect(() => scoreOperationSessionId({ ...receipt, kind: 'score.export' }, { teamId: 'team-1', actorUserId: 'student-1' })).toThrow(/different score operation/i);
    expect(() => scoreOperationSessionId(receipt, { teamId: 'team-2', actorUserId: 'student-1' })).toThrow(/different score operation/i);
    expect(() => scoreOperationSessionId(receipt, { teamId: 'team-1', actorUserId: 'student-2' })).toThrow(/different score operation/i);
  });
});
