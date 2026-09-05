import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, name: string, id: string) => ({ name, id })),
  getDoc: vi.fn(),
  httpsCallable: vi.fn(),
  getFirebaseServices: vi.fn(() => ({ functions: 'functions' }))
}));

vi.mock('firebase/firestore', () => ({ doc: mocks.doc, getDoc: mocks.getDoc }));
vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }));
vi.mock('./firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));

import {
  calculateScoreTotal,
  correctScoreSession,
  createScoreDefinition,
  createScoreSession,
  exportScoreReport,
  getScoreSessionTarget,
  listScoreDefinitions,
  listScoreSessions
} from './phase6-service';

describe('Phase 6 client service contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.httpsCallable.mockImplementation((_functions, name) => async (input: unknown) => ({ data: { name, input } }));
  });

  it('preserves every callable name, complete filter/mutation payload, and returned data', async () => {
    const definition = { teamId: 'team-1', definitionId: 'definition-1', title: 'Season', season: '2026', missions: [{ id: 'mission-1', name: 'Mission', maxPoints: 20 }], deductions: [] };
    const session = { teamId: 'team-1', sessionId: 'session-1', operationId: 'operation-1', scoreDefinitionId: 'definition-1', title: 'Practice', scoreType: 'practice' as const, sessionDate: '2026-01-02T00:00:00.000Z', eventId: null, missions: [{ missionId: 'mission-1', points: 20, completed: true }], deductions: [], notes: 'Good run', participantUserIds: ['user-1'], runTimeSeconds: 150, robotProgramContext: 'Program A' };
    const correction = { ...session, expectedVersion: 2 };
    const filters = { teamId: 'team-1', scoreType: 'match' as const, eventId: 'event-1', fromDate: '2026-01-01', toDate: '2026-02-01' };
    const cases: Array<[string, () => Promise<unknown>, unknown]> = [
      ['listScoreDefinitions', () => listScoreDefinitions('team-1'), { teamId: 'team-1' }],
      ['createScoreDefinition', () => createScoreDefinition(definition), definition],
      ['createScoreSession', () => createScoreSession(session), session],
      ['listScoreSessions', () => listScoreSessions(filters), filters],
      ['correctScoreSession', () => correctScoreSession(correction), correction],
      ['exportScoreReport', () => exportScoreReport(filters), filters]
    ];

    for (const [name, invoke, input] of cases) {
      await expect(invoke()).resolves.toEqual({ name, input });
      expect(mocks.httpsCallable).toHaveBeenLastCalledWith('functions', name);
    }
  });

  it('validates linked score scope before mapping the session', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getScoreSessionTarget('db' as never, 'team-1', 'missing')).rejects.toThrow(/not found/i);

    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, id: 'session-1', data: () => ({ teamId: 'team-2' }) });
    await expect(getScoreSessionTarget('db' as never, 'team-1', 'session-1')).rejects.toThrow(/does not belong/i);

    // A sparse document must degrade to defaults rather than reaching the page
    // half-formed and crashing it on a missing array.
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, id: 'session-1', data: () => ({ teamId: 'team-1', totalPoints: 20 }) });
    await expect(getScoreSessionTarget('db' as never, 'team-1', 'session-1')).resolves.toMatchObject({
      id: 'session-1',
      teamId: 'team-1',
      totalPoints: 20,
      missions: [],
      deductions: [],
      participantUserIds: [],
      scoreType: 'practice',
      version: 1
    });
  });

  it('calculates a non-negative client preview total', () => {
    expect(calculateScoreTotal([{ missionId: 'm1', points: 20, completed: true }], [{ deductionId: 'd1', points: 5 }])).toBe(15);
    expect(calculateScoreTotal([], [{ deductionId: 'd1', points: 5 }])).toBe(0);
  });

  it('propagates callable errors unchanged and without retry', async () => {
    const failure = new Error('permission denied');
    mocks.httpsCallable.mockReturnValueOnce(vi.fn().mockRejectedValue(failure));
    await expect(exportScoreReport({ teamId: 'team-1' })).rejects.toBe(failure);
    expect(mocks.httpsCallable).toHaveBeenCalledOnce();
  });
});
