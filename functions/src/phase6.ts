import { FieldValue, getFirestore, Timestamp, type DocumentData, type Query, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  assertTeamMemberInTransaction,
  requireString,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember,
  auditRecord,
} from './phase2.js';

export const SCORE_PAGE_SIZE = 50;
export const SCORE_EXPORT_LIMIT = 500;
export const MAX_MISSIONS = 30;
export const MAX_DEDUCTIONS = 20;

export type ScoreType = 'practice' | 'match';
export type ScoreMission = { id: string; name: string; maxPoints: number };
export type ScoreDeduction = { id: string; name: string; maxPoints: number };
export type EarnedMission = { missionId: string; points: number; completed: boolean };
export type AppliedDeduction = { deductionId: string; points: number };

type Phase6Request = CallableRequest<Record<string, unknown>>;

function input(request: Phase6Request) { return request.data ?? {}; }

function boundedStringArray(value: unknown, label: string, maxItems: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} must be a bounded list.`);
  const entries = value.map((entry) => requireString(entry, label, 128));
  if (new Set(entries).size !== entries.length) throw new HttpsError('invalid-argument', `${label} must not contain duplicates.`);
  return entries;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new HttpsError('invalid-argument', `${label} must be an integer from ${min} to ${max}.`);
  return number;
}

function timestamp(value: unknown, label: string, fallbackNow = false): Timestamp {
  if (value === undefined && fallbackNow) return Timestamp.now();
  if (value instanceof Timestamp) return value;
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpsError('invalid-argument', `${label} must be a valid date.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', `${label} must be a valid date.`);
  return Timestamp.fromDate(date);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string, fallback?: T): T {
  const next = value ?? fallback;
  if (!values.includes(next as T)) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return next as T;
}

function parseDefinitionItems(value: unknown, label: string, maxItems: number): Array<{ id: string; name: string; maxPoints: number }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) throw new HttpsError('invalid-argument', `${label} must contain 1 to ${maxItems} items.`);
  const items = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new HttpsError('invalid-argument', `${label} item ${index + 1} is invalid.`);
    const record = entry as Record<string, unknown>;
    return { id: requireString(record.id ?? `${label.toLowerCase()}-${index + 1}`, `${label} ID`, 64), name: requireString(record.name, `${label} name`, 160), maxPoints: integer(record.maxPoints, `${label} maximum points`, 0, 10000) };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new HttpsError('invalid-argument', `${label} IDs must be unique.`);
  return items;
}

function parseOptionalDefinitionItems(value: unknown, label: string, maxItems: number) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  return parseDefinitionItems(value, label, maxItems);
}

export function validateScoreDefinition(input: Record<string, unknown>) {
  const title = requireString(input.title, 'Scoring title', 160);
  const season = requireString(input.season, 'Scoring season', 40);
  const sourceType = enumValue(input.sourceType, ['team-defined', 'official-curated'] as const, 'Scoring source', 'team-defined');
  const sourceLabel = requireString(input.sourceLabel ?? (sourceType === 'team-defined' ? 'Team-defined scoring' : 'Official curated source'), 'Scoring source label', 160);
  const missions = parseDefinitionItems(input.missions, 'Mission', MAX_MISSIONS);
  const deductions = parseOptionalDefinitionItems(input.deductions, 'Deduction', MAX_DEDUCTIONS);
  return { title, season, sourceType, sourceLabel, missions, deductions };
}

function normalizeEarned(value: unknown, definitions: ScoreMission[]): EarnedMission[] {
  if (!Array.isArray(value) || value.length !== definitions.length) throw new HttpsError('invalid-argument', 'Every mission must have a score entry.');
  const byId = new Map(definitions.map((mission) => [mission.id, mission]));
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new HttpsError('invalid-argument', 'Mission score is invalid.');
    const record = entry as Record<string, unknown>;
    const missionId = requireString(record.missionId, 'Mission ID', 64);
    const definition = byId.get(missionId);
    if (!definition) throw new HttpsError('invalid-argument', 'Mission score is not part of this scoring definition.');
    return { missionId, points: integer(record.points, 'Mission points', 0, definition.maxPoints), completed: record.completed === true };
  });
  if (new Set(entries.map((entry) => entry.missionId)).size !== definitions.length) throw new HttpsError('invalid-argument', 'Mission scores must contain each mission exactly once.');
  return entries;
}

function normalizeDeductions(value: unknown, definitions: ScoreDeduction[]): AppliedDeduction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > definitions.length) throw new HttpsError('invalid-argument', 'Deductions are invalid.');
  const byId = new Map(definitions.map((deduction) => [deduction.id, deduction]));
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new HttpsError('invalid-argument', 'Deduction is invalid.');
    const record = entry as Record<string, unknown>;
    const deductionId = requireString(record.deductionId, 'Deduction ID', 64);
    const definition = byId.get(deductionId);
    if (!definition) throw new HttpsError('invalid-argument', 'Deduction is not part of this scoring definition.');
    return { deductionId, points: integer(record.points, 'Deduction points', 0, definition.maxPoints) };
  });
  if (new Set(entries.map((entry) => entry.deductionId)).size !== entries.length) throw new HttpsError('invalid-argument', 'Deductions must be unique.');
  return entries;
}

export function calculateScoreTotal(missions: EarnedMission[], deductions: AppliedDeduction[]) {
  return Math.max(0, missions.reduce((total, mission) => total + mission.points, 0) - deductions.reduce((total, deduction) => total + deduction.points, 0));
}

async function activeParticipants(transaction: Transaction, teamId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length > 20) throw new HttpsError('invalid-argument', 'A session can have at most 20 participants.');
  for (const userId of unique) await assertTeamMemberInTransaction(transaction, teamId, userId);
  return unique;
}

async function definitionFor(transaction: Transaction, teamId: string, definitionId: string) {
  const snapshot = await transaction.get(getFirestore().doc(`scoreDefinitions/${definitionId}`));
  if (!snapshot.exists || snapshot.data()?.teamId !== teamId || snapshot.data()?.active === false) throw new HttpsError('not-found', 'Scoring definition not found in this team.');
  return { ref: snapshot.ref, data: snapshot.data() ?? {} };
}

function sessionFields(input: Record<string, unknown>, definition: DocumentData) {
  const missions = normalizeEarned(input.missions, (definition.missions ?? []) as ScoreMission[]);
  const deductions = normalizeDeductions(input.deductions, (definition.deductions ?? []) as ScoreDeduction[]);
  const participants = boundedStringArray(input.participantUserIds, 'Participants', 20);
  const scoreType = enumValue(input.scoreType, ['practice', 'match'] as const, 'Score type');
  const sessionDate = timestamp(input.sessionDate, 'Session date', true);
  const eventId = input.eventId === undefined || input.eventId === null || input.eventId === '' ? null : requireString(input.eventId, 'Event ID');
  const notes = input.notes === undefined ? '' : requireString(input.notes, 'Notes', 4000);
  const robotProgramContext = input.robotProgramContext === undefined ? '' : requireString(input.robotProgramContext, 'Robot/program context', 240);
  const runTimeSeconds = input.runTimeSeconds === undefined ? null : integer(input.runTimeSeconds, 'Run time', 0, 3600);
  const title = input.title === undefined ? `${scoreType[0].toUpperCase()}${scoreType.slice(1)} session` : requireString(input.title, 'Session title', 160);
  return { scoreType, sessionDate, eventId, notes, robotProgramContext, runTimeSeconds, title, participantUserIds: participants, missions, deductions, totalPoints: calculateScoreTotal(missions, deductions) };
}

function operationKey(teamId: string, value: unknown) { return value === undefined ? null : `${teamId}_${requireString(value, 'Operation ID', 120)}`; }

export function scoreOperationSessionId(
  receipt: Record<string, unknown>,
  expected: { teamId: string; actorUserId: string }
) {
  if (receipt.teamId !== expected.teamId
    || receipt.createdBy !== expected.actorUserId
    || receipt.kind !== 'score.session.create') {
    throw new HttpsError('failed-precondition', 'This operation ID belongs to a different score operation.');
  }
  return requireString(receipt.sessionId, 'Stored score session ID');
}

function publicSession(id: string, data: DocumentData) { return { id, ...data }; }

async function querySessions(teamId: string, filters: Record<string, unknown>) {
  const db = getFirestore();
  const from = filters.fromDate ? timestamp(filters.fromDate, 'From date') : null;
  const to = filters.toDate ? timestamp(filters.toDate, 'To date') : null;
  const scoreType = filters.scoreType === undefined ? undefined : enumValue(filters.scoreType, ['practice', 'match'] as const, 'Score type');
  const eventId = filters.eventId === undefined || filters.eventId === '' ? undefined : requireString(filters.eventId, 'Event ID');
  let sessionsQuery: Query<DocumentData> = db.collection('scoreSessions').where('teamId', '==', teamId);
  if (scoreType) sessionsQuery = sessionsQuery.where('scoreType', '==', scoreType);
  if (eventId) sessionsQuery = sessionsQuery.where('eventId', '==', eventId);
  if (from) sessionsQuery = sessionsQuery.where('sessionDate', '>=', from);
  if (to) sessionsQuery = sessionsQuery.where('sessionDate', '<=', to);
  const snapshots = await sessionsQuery.orderBy('sessionDate', 'desc').limit(SCORE_EXPORT_LIMIT + 1).get();
  const sessions = snapshots.docs.slice(0, SCORE_EXPORT_LIMIT).map((snapshot) => publicSession(snapshot.id, snapshot.data()));
  return { sessions, sourceTruncated: snapshots.size > SCORE_EXPORT_LIMIT };
}

export function scoreResponseMetadata(matchingCount: number, sourceTruncated: boolean) {
  return {
    historyTruncated: matchingCount > SCORE_PAGE_SIZE || sourceTruncated,
    statisticsTruncated: sourceTruncated,
    statisticsLimit: SCORE_EXPORT_LIMIT
  };
}

export function summarizeScores(sessions: Array<Record<string, unknown>>) {
  const totals = sessions.map((session) => Number(session.totalPoints ?? 0));
  const missionTrends: Record<string, { attempts: number; completed: number; points: number }> = {};
  const sessionTypeTrends: Record<string, { count: number; totalPoints: number }> = {};
  sessions.forEach((session) => {
    const scoreType = String(session.scoreType ?? 'unknown');
    sessionTypeTrends[scoreType] ??= { count: 0, totalPoints: 0 };
    sessionTypeTrends[scoreType].count += 1;
    sessionTypeTrends[scoreType].totalPoints += Number(session.totalPoints ?? 0);
    for (const mission of (session.missions ?? []) as EarnedMission[]) {
      missionTrends[mission.missionId] ??= { attempts: 0, completed: 0, points: 0 };
      missionTrends[mission.missionId].attempts += 1;
      missionTrends[mission.missionId].completed += mission.completed ? 1 : 0;
      missionTrends[mission.missionId].points += mission.points;
    }
  });
  const total = totals.reduce((sum, value) => sum + value, 0);
  return { count: totals.length, total, average: totals.length ? total / totals.length : 0, best: totals.length ? Math.max(...totals) : 0, completionRate: sessions.length ? Object.values(missionTrends).reduce((sum, trend) => sum + trend.completed, 0) / Math.max(1, Object.values(missionTrends).reduce((sum, trend) => sum + trend.attempts, 0)) : 0, missionTrends, sessionTypeTrends };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildScoreCsv(sessions: Array<Record<string, unknown>>) {
  const rows = [['Session date', 'Score type', 'Title', 'Total points', 'Participants', 'Run time (seconds)', 'Notes', 'Robot/program context']];
  for (const session of sessions) rows.push([
    String((session.sessionDate as Timestamp | undefined)?.toDate?.().toISOString?.() ?? session.sessionDate ?? ''),
    String(session.scoreType ?? ''), String(session.title ?? ''), String(session.totalPoints ?? 0),
    Array.isArray(session.participantUserIds) ? session.participantUserIds.join('; ') : '', String(session.runTimeSeconds ?? ''), String(session.notes ?? ''), String(session.robotProgramContext ?? '')
  ]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export const createScoreDefinition = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const fields = validateScoreDefinition(input(request));
  if (fields.sourceType === 'official-curated' && !actor.platformAdmin) throw new HttpsError('permission-denied', 'Only an approved platform administrator can publish official curated scoring.');
  const db = getFirestore();
  const definitionId = input(request).definitionId === undefined ? db.collection('scoreDefinitions').doc().id : requireString(input(request).definitionId, 'Definition ID');
  const ref = db.doc(`scoreDefinitions/${definitionId}`);
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const existing = await transaction.get(ref);
    if (existing.exists) return;
    const now = FieldValue.serverTimestamp();
    transaction.set(ref, { id: definitionId, teamId, createdBy: actor.uid, ...fields, active: true, createdAt: now, updatedAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `scoreDefinitions/${definitionId}`, metadata: { action: 'score.definition.created' } }));
  });
  return { definitionId };
};

export const listScoreDefinitions = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const snapshots = await getFirestore().collection('scoreDefinitions').where('teamId', '==', teamId).where('active', '==', true).orderBy('updatedAt', 'desc').limit(20).get();
  return { definitions: snapshots.docs.map((snapshot) => publicSession(snapshot.id, snapshot.data())), actorUserId: actor.uid };
};

export const createScoreSession = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const db = getFirestore();
  const sessionId = input(request).sessionId === undefined ? db.collection('scoreSessions').doc().id : requireString(input(request).sessionId, 'Session ID');
  const sessionRef = db.doc(`scoreSessions/${sessionId}`);
  const opKey = operationKey(teamId, input(request).operationId);
  const opRef = opKey ? db.doc(`phase6Operations/${opKey}`) : null;
  const committedSessionId = await db.runTransaction(async (transaction) => {
    await assertTeamMemberInTransaction(transaction, teamId, actor.uid);
    const operation = opRef ? await transaction.get(opRef) : null;
    if (operation?.exists) {
      const replaySessionId = scoreOperationSessionId(operation.data() ?? {}, { teamId, actorUserId: actor.uid });
      const replaySession = await transaction.get(db.doc(`scoreSessions/${replaySessionId}`));
      if (!replaySession.exists
        || replaySession.data()?.teamId !== teamId
        || replaySession.data()?.createdBy !== actor.uid) {
        throw new HttpsError('failed-precondition', 'The stored score operation result is unavailable.');
      }
      return replaySessionId;
    }
    const existing = await transaction.get(sessionRef);
    if (existing.exists) {
      if (existing.data()?.teamId !== teamId || existing.data()?.createdBy !== actor.uid) {
        throw new HttpsError('already-exists', 'Session ID is already used by another score session.');
      }
      return sessionId;
    }
    const definition = await definitionFor(transaction, teamId, requireString(input(request).scoreDefinitionId, 'Scoring definition ID'));
    const fields = sessionFields(input(request), definition.data);
    if (fields.eventId) {
      const event = await transaction.get(db.doc(`events/${fields.eventId}`));
      if (!event.exists || event.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Event not found in this team.');
    }
    const participants = await activeParticipants(transaction, teamId, fields.participantUserIds);
    const now = FieldValue.serverTimestamp();
    transaction.set(sessionRef, { id: sessionId, teamId, scoreDefinitionId: definition.ref.id, scoringSeason: definition.data.season, scoringSourceType: definition.data.sourceType, scoringSourceLabel: definition.data.sourceLabel, scoringMissions: definition.data.missions, scoringDeductions: definition.data.deductions ?? [], createdBy: actor.uid, ...fields, participantUserIds: participants, version: 1, createdAt: now, updatedAt: now });
    transaction.set(db.collection('scoreSessionHistory').doc(), { id: sessionId, teamId, sessionId, actorUserId: actor.uid, action: 'created', changedFields: ['created'], previousSnapshot: null, currentSnapshot: { totalPoints: fields.totalPoints, scoreType: fields.scoreType }, createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `scoreSessions/${sessionId}`, metadata: { action: 'score.session.created' } }));
    if (opRef) transaction.set(opRef, { teamId, sessionId, createdBy: actor.uid, kind: 'score.session.create', createdAt: now });
    return sessionId;
  });
  return { sessionId: committedSessionId };
};

export const listScoreSessions = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamMember(request, teamId);
  const result = await querySessions(teamId, input(request));
  return {
    sessions: result.sessions.slice(0, SCORE_PAGE_SIZE),
    statistics: summarizeScores(result.sessions),
    ...scoreResponseMetadata(result.sessions.length, result.sourceTruncated),
    actorUserId: actor.uid
  };
};

export const correctScoreSession = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const sessionId = requireString(input(request).sessionId, 'Session ID');
  const expectedVersion = integer(input(request).expectedVersion, 'Expected version', 1, 1000000);
  const sessionRef = getFirestore().doc(`scoreSessions/${sessionId}`);
  await getFirestore().runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, actor);
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Score session not found in this team.');
    const current = snapshot.data() ?? {};
    if (Number(current.version) !== expectedVersion) throw new HttpsError('aborted', 'This score changed while you were editing it. Reload before correcting it.');
    const definition = await definitionFor(transaction, teamId, requireString(current.scoreDefinitionId, 'Scoring definition ID'));
    const pinnedDefinition = { ...definition.data, missions: current.scoringMissions ?? definition.data.missions, deductions: current.scoringDeductions ?? definition.data.deductions ?? [] };
    const fields = sessionFields({ ...current, ...input(request) }, pinnedDefinition);
    // Corrections must validate participants the same way creation does.
    fields.participantUserIds = await activeParticipants(transaction, teamId, fields.participantUserIds);
    const now = FieldValue.serverTimestamp();
    const nextVersion = expectedVersion + 1;
    const changedFields = (Object.keys(fields) as Array<keyof typeof fields>).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(fields[key]));
    transaction.update(sessionRef, { ...fields, version: nextVersion, correctedBy: actor.uid, updatedAt: now });
    transaction.set(getFirestore().collection('scoreSessionHistory').doc(), { id: sessionId, teamId, sessionId, actorUserId: actor.uid, action: 'corrected', changedFields, previousSnapshot: { totalPoints: current.totalPoints, missions: current.missions, deductions: current.deductions, notes: current.notes }, currentSnapshot: { totalPoints: fields.totalPoints, missions: fields.missions, deductions: fields.deductions, notes: fields.notes }, createdAt: now });
    transaction.set(getFirestore().collection('auditEvents').doc(), auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `scoreSessions/${sessionId}`, metadata: { action: 'score.session.corrected' } }));
  });
  return { sessionId, corrected: true, version: expectedVersion + 1 };
};

export const exportScoreReport = async (request: Phase6Request) => {
  const teamId = requireTeamId(request);
  const actor = await requireTeamAdmin(request, teamId);
  const result = await querySessions(teamId, input(request));
  const csv = buildScoreCsv(result.sessions);
  await getFirestore().collection('auditEvents').add(auditRecord({ type: 'administrative.action', actorUserId: actor.uid, teamId, targetResource: `scoreExports/${teamId}`, metadata: { action: 'score.exported' } }));
  return { teamId, filename: `first-pit-scores-${teamId}.csv`, csv, count: result.sessions.length, truncated: result.sourceTruncated, limit: SCORE_EXPORT_LIMIT, actorUserId: actor.uid };
};
