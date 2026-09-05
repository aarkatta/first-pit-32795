import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { AppError } from './app-error';
import { call } from './callable';
import { toDate } from './dates';

export type ScoreType = 'practice' | 'match';
export type ScoreMission = { id: string; name: string; maxPoints: number };
export type ScoreDeduction = { id: string; name: string; maxPoints: number };
export type EarnedMission = { missionId: string; points: number; completed: boolean };
export type AppliedDeduction = { deductionId: string; points: number };
export type ScoreDefinition = { id: string; teamId: string; title: string; season: string; sourceType: 'team-defined' | 'official-curated'; sourceLabel: string; missions: ScoreMission[]; deductions: ScoreDeduction[]; active: boolean };
export type ScoreSession = { id: string; teamId: string; scoreDefinitionId: string; scoringSeason: string; scoringSourceType: ScoreDefinition['sourceType']; scoringSourceLabel: string; title: string; scoreType: ScoreType; sessionDate: unknown; eventId: string | null; missions: EarnedMission[]; deductions: AppliedDeduction[]; totalPoints: number; notes: string; participantUserIds: string[]; runTimeSeconds: number | null; robotProgramContext: string; version: number };
export type ScoreStatistics = { count: number; total: number; average: number; best: number; completionRate: number; missionTrends: Record<string, { attempts: number; completed: number; points: number }>; sessionTypeTrends: Record<string, { count: number; totalPoints: number }> };


export function listScoreDefinitions(teamId: string) {
  return call<{ teamId: string }, { definitions: ScoreDefinition[] }>('listScoreDefinitions', { teamId });
}

export function createScoreDefinition(input: { teamId: string; definitionId?: string; title: string; season: string; sourceType?: ScoreDefinition['sourceType']; sourceLabel?: string; missions: ScoreMission[]; deductions: ScoreDeduction[] }) {
  return call<typeof input, { definitionId: string }>('createScoreDefinition', input);
}

export function createScoreSession(input: { teamId: string; sessionId?: string; operationId: string; scoreDefinitionId: string; title: string; scoreType: ScoreType; sessionDate: string; eventId?: string | null; missions: EarnedMission[]; deductions: AppliedDeduction[]; notes?: string; participantUserIds?: string[]; runTimeSeconds?: number | null; robotProgramContext?: string }) {
  return call<typeof input, { sessionId: string }>('createScoreSession', input);
}

export function listScoreSessions(input: { teamId: string; scoreType?: ScoreType; eventId?: string; fromDate?: string; toDate?: string }) {
  return call<typeof input, { sessions: ScoreSession[]; statistics: ScoreStatistics; historyTruncated: boolean; statisticsTruncated: boolean; statisticsLimit: number }>('listScoreSessions', input);
}

/**
 * Reads one session field by field rather than casting the raw document, so a
 * record written by an older schema degrades instead of crashing the page on a
 * missing array.
 */
function parseScoreSession(id: string, data: Record<string, unknown>): ScoreSession {
  const missions = Array.isArray(data.missions) ? (data.missions as EarnedMission[]) : [];
  const deductions = Array.isArray(data.deductions) ? (data.deductions as AppliedDeduction[]) : [];
  return {
    id,
    teamId: String(data.teamId ?? ''),
    scoreDefinitionId: String(data.scoreDefinitionId ?? ''),
    scoringSeason: String(data.scoringSeason ?? ''),
    scoringSourceType: (data.scoringSourceType === 'official-curated' ? 'official-curated' : 'team-defined'),
    scoringSourceLabel: String(data.scoringSourceLabel ?? ''),
    title: String(data.title ?? 'Score session'),
    scoreType: data.scoreType === 'match' ? 'match' : 'practice',
    sessionDate: toDate(data.sessionDate),
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    missions,
    deductions,
    totalPoints: Number(data.totalPoints ?? 0),
    notes: String(data.notes ?? ''),
    participantUserIds: Array.isArray(data.participantUserIds) ? data.participantUserIds.map(String) : [],
    runTimeSeconds: typeof data.runTimeSeconds === 'number' ? data.runTimeSeconds : null,
    robotProgramContext: String(data.robotProgramContext ?? ''),
    version: Number(data.version ?? 1)
  };
}

export async function getScoreSessionTarget(firestore: Firestore, teamId: string, sessionId: string) {
  const snapshot = await getDoc(doc(firestore, 'scoreSessions', sessionId));
  if (!snapshot.exists()) throw new AppError('not-found', 'The linked score session was not found or is no longer available.');
  const data = snapshot.data() as Record<string, unknown>;
  if (data.teamId !== teamId) throw new AppError('permission-denied', 'The linked score session does not belong to this team.');
  return parseScoreSession(snapshot.id, data);
}

export function correctScoreSession(input: { teamId: string; sessionId: string; expectedVersion: number; title: string; scoreType: ScoreType; sessionDate: string; eventId?: string | null; missions: EarnedMission[]; deductions: AppliedDeduction[]; notes?: string; participantUserIds?: string[]; runTimeSeconds?: number | null; robotProgramContext?: string }) {
  return call<typeof input, { sessionId: string; corrected: true; version: number }>('correctScoreSession', input);
}

export function exportScoreReport(input: { teamId: string; scoreType?: ScoreType; eventId?: string; fromDate?: string; toDate?: string }) {
  return call<typeof input, { teamId: string; filename: string; csv: string; count: number; truncated: boolean; limit: number }>('exportScoreReport', input);
}

export function calculateScoreTotal(missions: EarnedMission[], deductions: AppliedDeduction[]) {
  return Math.max(0, missions.reduce((total, mission) => total + mission.points, 0) - deductions.reduce((total, deduction) => total + deduction.points, 0));
}
