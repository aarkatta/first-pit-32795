import {
  collection,
  documentId,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit,
  where,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore';
import type { Membership, Team, TeamRole } from './domain';
import { isValidFirestoreId, TEAM_ROLES } from './domain';

export type TeamMembership = Membership & { team: Team | null };
export const MAX_USER_TEAMS = 50;
const TEAM_QUERY_LIMIT = MAX_USER_TEAMS + 1;

/**
 * Returns null for a malformed record rather than throwing. A single corrupt
 * membership document used to reject the whole snapshot handler, which left the
 * user unable to reach any of their teams.
 */
function readMembership(id: string, data: Record<string, unknown>): Membership | null {
  const teamId = String(data.teamId ?? '');
  const userId = String(data.userId ?? '');
  const statuses = ['active', 'pending', 'suspended', 'removed'] as const;
  if (!TEAM_ROLES.includes(data.role as TeamRole)) return null;
  const role = data.role as TeamRole;
  if (!statuses.includes(data.status as typeof statuses[number])) return null;
  const status = data.status as typeof statuses[number];
  if (id !== `${teamId}_${userId}`) return null;
  return {
    id,
    teamId,
    userId,
    role,
    status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

function readTeam(id: string, data: Record<string, unknown>): Team {
  return {
    id,
    name: String(data.name ?? ''),
    normalizedName: String(data.normalizedName ?? ''),
    teamNumber: typeof data.teamNumber === 'string' && data.teamNumber ? data.teamNumber : null,
    createdBy: String(data.createdBy ?? ''),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export function subscribeToUserTeams(
  firestore: Firestore,
  userId: string,
  onChange: (teams: TeamMembership[]) => void,
  onError: (error: Error) => void
): Unsubscribe {
  if (!isValidFirestoreId(userId)) {
    throw new Error('User ID must be a non-empty Firestore document ID.');
  }

  const membershipQuery = buildUserMembershipQuery(firestore, userId);
  let subscribed = true;
  let snapshotGeneration = 0;

  const unsubscribe = onSnapshot(
    membershipQuery,
    async (snapshot) => {
      const generation = ++snapshotGeneration;
      try {
        if (!subscribed || generation !== snapshotGeneration) return;
        const memberships = snapshot.docs
          .map((document) => readMembership(document.id, document.data() as Record<string, unknown>))
          .filter((membership): membership is Membership => membership !== null);
        if (snapshot.size > MAX_USER_TEAMS) {
          onError(new Error(`This account has more than ${MAX_USER_TEAMS} active team memberships. Contact support before continuing.`));
          return;
        }
        const teamIds = [...new Set(memberships.map((membership) => membership.teamId))];
        const chunks = Array.from({ length: Math.ceil(teamIds.length / 10) }, (_, index) => teamIds.slice(index * 10, index * 10 + 10));
        const teamSnapshots = await Promise.allSettled(
          chunks.map((chunk) => getDocs(query(collection(firestore, 'teams'), where(documentId(), 'in', chunk))))
        );
        if (!subscribed || generation !== snapshotGeneration) return;
        const teams = new Map(
          teamSnapshots
            .filter((result) => result.status === 'fulfilled')
            .flatMap((result) => result.value.docs)
            .map((document) => [document.id, readTeam(document.id, document.data() as Record<string, unknown>)])
        );
        if (!subscribed) return;
        onChange(memberships.map((membership) => ({ ...membership, team: teams.get(membership.teamId) ?? null })));
      } catch (error) {
        if (!subscribed || generation !== snapshotGeneration) return;
        onError(error instanceof Error ? error : new Error('Could not load teams.'));
      }
    },
    (error) => {
      if (subscribed) onError(error);
    }
  );

  return () => {
    subscribed = false;
    unsubscribe();
  };
}

export function buildUserMembershipQuery(firestore: Firestore, userId: string) {
  return query(
    collection(firestore, 'memberships'),
    where('userId', '==', userId),
    where('status', '==', 'active'),
    limit(TEAM_QUERY_LIMIT),
    orderBy('createdAt', 'desc')
  );
}
