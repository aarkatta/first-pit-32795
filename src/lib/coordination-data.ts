import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore';
import type { NotificationRecord, TeamGoal } from './domain';
import { parseTeamGoal } from './phase3-service';
import { toDate } from './dates';

/**
 * Reads shared by the Tracker, Milestones, Team files and Notifications
 * screens. Each screen loads only what it shows: a team whose policy or rules
 * deny one of them still gets the others.
 */

export type FileSharing = 'disabled' | 'teamOnly';

export function formatRecordDate(value: unknown): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'No date';
}

export function parseNotification(id: string, data: Record<string, unknown>): NotificationRecord {
  return {
    id,
    teamId: String(data.teamId ?? ''),
    createdBy: String(data.createdBy ?? ''),
    recipientUserId: String(data.recipientUserId ?? ''),
    type: (data.type ?? 'system') as NotificationRecord['type'],
    title: String(data.title ?? 'Notification'),
    body: String(data.body ?? ''),
    deepLink: String(data.deepLink ?? '/coordination'),
    dedupeKey: String(data.dedupeKey ?? id),
    mandatory: data.mandatory === true,
    readAt: data.readAt ?? null
  };
}

/** Every milestone, achieved ones included, soonest target date first. */
export async function loadTeamGoals(firestore: Firestore, teamId: string, max = 50): Promise<TeamGoal[]> {
  const snapshot = await getDocs(query(
    collection(firestore, 'goals'),
    where('teamId', '==', teamId),
    orderBy('dueAt', 'asc'),
    limit(max)
  ));
  return snapshot.docs.map((document) => parseTeamGoal(document.id, document.data() as Record<string, unknown>));
}

/** One milestone by id, for a `?goal=` deep link older than the first page. */
export async function loadTeamGoal(firestore: Firestore, teamId: string, goalId: string): Promise<TeamGoal | null> {
  const snapshot = await getDoc(doc(firestore, 'goals', goalId));
  if (!snapshot.exists() || snapshot.data().teamId !== teamId) return null;
  return parseTeamGoal(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function loadTeamNotifications(firestore: Firestore, teamId: string, userId: string, max = 50): Promise<NotificationRecord[]> {
  const snapshot = await getDocs(query(
    collection(firestore, 'notifications'),
    where('recipientUserId', '==', userId),
    where('teamId', '==', teamId),
    orderBy('createdAt', 'desc'),
    limit(max)
  ));
  return snapshot.docs.map((document) => parseNotification(document.id, document.data() as Record<string, unknown>));
}

/**
 * The unread badge stops counting here; anything above renders as "99+", so
 * the listener never reads more than this many documents.
 */
export const UNREAD_BADGE_LIMIT = 100;

export function formatUnreadBadge(count: number): string {
  return count >= UNREAD_BADGE_LIMIT ? '99+' : String(count);
}

/** Live count of this member's unread notifications on one team, capped at `UNREAD_BADGE_LIMIT`. */
export function subscribeUnreadNotificationCount(
  firestore: Firestore,
  teamId: string,
  userId: string,
  onNext: (count: number) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(query(
    collection(firestore, 'notifications'),
    where('recipientUserId', '==', userId),
    where('teamId', '==', teamId),
    where('readAt', '==', null),
    orderBy('createdAt', 'desc'),
    limit(UNREAD_BADGE_LIMIT)
  ), (snapshot) => onNext(snapshot.size), onError);
}

/** Live view of this member's most recent notifications on one team, read and unread. */
export function subscribeRecentNotifications(
  firestore: Firestore,
  teamId: string,
  userId: string,
  max: number,
  onNext: (notifications: NotificationRecord[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  return onSnapshot(query(
    collection(firestore, 'notifications'),
    where('recipientUserId', '==', userId),
    where('teamId', '==', teamId),
    orderBy('createdAt', 'desc'),
    limit(max)
  ), (snapshot) => onNext(snapshot.docs.map((document) => parseNotification(document.id, document.data() as Record<string, unknown>))), onError);
}

/**
 * The Storage Area is readable only while team policy enables file sharing, so
 * the policy decides whether a file query is even attempted.
 */
export async function loadFileSharing(firestore: Firestore, teamId: string): Promise<FileSharing> {
  const snapshot = await getDoc(doc(firestore, 'teamPolicies', teamId));
  return snapshot.data()?.fileSharing === 'teamOnly' ? 'teamOnly' : 'disabled';
}
