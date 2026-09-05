import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { handleApiRequest, moderationCaseVersion, phase2OperationReceipt, reportOperationResult } from '../src/index';

/**
 * The deployed callable surface, by name.
 *
 * `typeof callable === 'function'` was the previous assertion and it caught
 * nothing: every `onCall` result is a function, so a deleted, renamed, or
 * accidentally added export all passed. Deployment identity IS the public API —
 * a rename silently breaks every client `httpsCallable` — so the list is
 * spelled out and compared exactly. Update it deliberately when a callable is
 * genuinely added or removed.
 */
const EXPECTED_CALLABLES = [
  'acceptAnswer', 'acceptInvitation', 'acknowledgeAnnouncement', 'addProjectColumn', 'approveJoinRequest',
  'archiveChannel', 'archiveProject', 'assignTeamRole', 'closePoll', 'completeFileUpload',
  'correctScoreSession', 'createAnnouncement', 'createAnswer', 'createChannel', 'createEvent',
  'createFileMetadata', 'createGoal', 'createInvitation', 'createKanbanTask', 'createPoll',
  'createProject', 'createQuestion', 'createQuestionComment', 'createReport', 'createScoreDefinition',
  'createScoreSession', 'createTask', 'createTeam', 'createVideo', 'deleteEvent',
  'deleteMessage', 'disconnectGoogle', 'ensureDefaultProject', 'exportScoreReport', 'exportTeamMessages',
  'getDashboard', 'getGoogleConnection', 'getPollResults', 'getTeamCalendarSync', 'globalSearch',
  'leaveTeam', 'linkFileToTask', 'listGoogleCalendars', 'listMyGoogleEvents', 'listPolls',
  'listScoreDefinitions', 'listScoreSessions', 'listTeamMembers', 'markChannelRead', 'markNotificationRead',
  'moveTaskCard', 'purgeExpiredMessages', 'recordVideoWatch', 'rejectJoinRequest', 'removeProjectColumn',
  'reorderProjectColumns', 'requestAccountDeletion', 'requestToJoinTeam', 'revokeInvitation', 'searchMessages',
  'searchQuestions', 'searchVideos', 'sendMessage', 'setTeamCalendarSync', 'setTeamChatLink',
  'startGoogleOAuth', 'syncTeamCalendar', 'toggleChannelMute', 'toggleReaction', 'toggleSavedQuestion',
  'toggleVideoFavorite', 'transferTeamLeadership', 'updateEvent', 'updateGoal', 'updateMembershipStatus',
  'updateModerationCase', 'updatePrivacySettings', 'updateProfileSettings', 'updateProject', 'updateProjectColumn',
  'updateTask', 'updateTeamPolicy', 'updateVideoPublication', 'votePoll', 'voteQuestion'
] as const;

/**
 * Exports that are deliberately not client callables: the HTTP health endpoint,
 * the nightly retention schedule (Cloud Scheduler invokes it, no client can),
 * and pure helpers exported for tests.
 */
const EXPECTED_NON_CALLABLES = ['api', 'enforceMessageRetention', 'handleApiRequest', 'handleGoogleOAuthCallback', 'handleRequestWithIntegrations', 'moderationCaseVersion', 'phase2OperationReceipt', 'reportOperationResult', 'syncGoogleCalendars'] as const;

/**
 * A client callable, specifically. Scheduled and HTTP functions also expose
 * `run` and `__endpoint`, so the trigger kind is what separates the surface a
 * client can reach from the rest.
 */
function isCallable(value: unknown) {
  if (typeof value !== 'function') return false;
  const endpoint = (value as { __endpoint?: Record<string, unknown> }).__endpoint;
  return typeof (value as { run?: unknown }).run === 'function'
    && typeof endpoint === 'object'
    && endpoint !== null
    && 'callableTrigger' in endpoint;
}

type ResponseState = {
  body?: unknown;
  headers: Record<string, string>;
  statusCode: number;
};

function makeResponse(): { response: Response; state: ResponseState } {
  const state: ResponseState = {
    headers: {},
    statusCode: 200
  };

  const response = {
    json(body: unknown) {
      state.body = body;
      return response;
    },
    send(body?: unknown) {
      state.body = body;
      return response;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return response;
    }
  } as unknown as Response;

  return { response, state };
}

function makeRequest(method: string, path: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    path,
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  } as unknown as Request;
}

describe('Functions API', () => {
  it('deploys exactly the expected callable names', () => {
    const deployed = Object.keys(api).filter((name) => isCallable((api as Record<string, unknown>)[name])).sort();
    expect(deployed).toEqual([...EXPECTED_CALLABLES].sort());
  });

  it('exports nothing beyond the callables and the known helper surface', () => {
    const unexpected = Object.keys(api).filter((name) => !EXPECTED_CALLABLES.includes(name as never) && !EXPECTED_NON_CALLABLES.includes(name as never));
    expect(unexpected).toEqual([]);
  });

  it('keeps every client-facing callable of the Kanban board deployed', () => {
    // The board's callables are the ones a rename would break most visibly.
    for (const name of ['ensureDefaultProject', 'createProject', 'updateProject', 'archiveProject', 'addProjectColumn',
      'updateProjectColumn', 'reorderProjectColumns', 'removeProjectColumn', 'createKanbanTask', 'moveTaskCard']) {
      expect(EXPECTED_CALLABLES).toContain(name);
      expect(isCallable((api as Record<string, unknown>)[name])).toBe(true);
    }
  });

  it('replays a safety report receipt only for its own reporter, team, and kind', () => {
    const receipt = { teamId: 'team-1', createdBy: 'student-1', kind: 'report.create', reportId: 'report-1', moderationCaseId: 'case-1' };
    expect(reportOperationResult(receipt, { teamId: 'team-1', actorUserId: 'student-1' })).toEqual({ reportId: 'report-1', moderationCaseId: 'case-1' });
    expect(() => reportOperationResult(receipt, { teamId: 'team-2', actorUserId: 'student-1' })).toThrow(/different team operation/i);
    expect(() => reportOperationResult(receipt, { teamId: 'team-1', actorUserId: 'student-2' })).toThrow(/different team operation/i);
    expect(() => reportOperationResult({ ...receipt, kind: 'role.assign' }, { teamId: 'team-1', actorUserId: 'student-1' })).toThrow(/different team operation/i);
  });

  it('never replays one team operation receipt as another', () => {
    const receipt = { teamId: 'team-1', createdBy: 'coach-1', kind: 'role.assign', targetUserId: 'student-1' };
    expect(phase2OperationReceipt(receipt, { teamId: 'team-1', actorUserId: 'coach-1', kind: 'role.assign' })).toBe(receipt);
    // A receipt written by an invitation must never satisfy a role change with
    // the same operation id, or a retry would skip the role change entirely.
    expect(() => phase2OperationReceipt(receipt, { teamId: 'team-1', actorUserId: 'coach-1', kind: 'invitation.create' })).toThrow(/different team operation/i);
    expect(() => phase2OperationReceipt(receipt, { teamId: 'team-1', actorUserId: 'coach-2', kind: 'role.assign' })).toThrow(/different team operation/i);
  });

  it('rejects a moderation case edit with a missing or malformed expected version', () => {
    // Moderation cases predate the version field, so a stored absence reads as 1.
    expect(moderationCaseVersion(1, 'Expected version')).toBe(1);
    expect(moderationCaseVersion(7, 'Expected version')).toBe(7);
    expect(() => moderationCaseVersion(undefined, 'Expected version')).toThrow(/Expected version must be a positive integer/);
    expect(() => moderationCaseVersion(0, 'Expected version')).toThrow(/positive integer/);
    expect(() => moderationCaseVersion(-1, 'Expected version')).toThrow(/positive integer/);
    expect(() => moderationCaseVersion(1.5, 'Expected version')).toThrow(/positive integer/);
    expect(() => moderationCaseVersion('two', 'Expected version')).toThrow(/positive integer/);
  });

  it('keeps the public health endpoint available', () => {
    const { response, state } = makeResponse();

    handleApiRequest(makeRequest('GET', '/healthz'), response);

    expect(state.statusCode).toBe(200);
    expect(state.body).toEqual({
      ok: true,
      service: 'first-pit-functions',
      phase: 4
    });
  });

  it('returns 405 for unsupported health methods', () => {
    const { response, state } = makeResponse();

    handleApiRequest(makeRequest('POST', '/healthz'), response);

    expect(state.statusCode).toBe(405);
    expect(state.headers.Allow).toBe('GET, OPTIONS');
  });

  it('returns 404 for unknown routes', () => {
    const { response, state } = makeResponse();

    handleApiRequest(makeRequest('GET', '/future-route'), response);

    expect(state.statusCode).toBe(404);
  });

  it('restricts CORS to configured local origins and methods', () => {
    const { response, state } = makeResponse();

    handleApiRequest(makeRequest('GET', '/healthz', { origin: 'http://localhost:5173' }), response);

    expect(state.statusCode).toBe(200);
    expect(state.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(state.headers['Access-Control-Allow-Methods']).toBe('GET');
  });

  it('rejects requests from untrusted origins', () => {
    const { response, state } = makeResponse();

    handleApiRequest(makeRequest('GET', '/healthz', { origin: 'https://untrusted.example' }), response);

    expect(state.statusCode).toBe(403);
  });
});
