#!/usr/bin/env node
/**
 * Materialize every First Pit collection in a Firestore database.
 *
 * Firestore has no schema and no "create collection" operation: a collection
 * exists only while it holds at least one document, and disappears when the
 * last one is deleted. This script therefore writes a single inert placeholder
 * document into each collection so the structure is visible in the console and
 * in tooling.
 *
 * The placeholders carry teamId "_schema", which matches no membership, so
 * every read rule denies them and no feature query can return them.
 *
 * Auth uses the caller's gcloud access token — no service-account key needed:
 *   gcloud auth login          # once
 *
 * Usage:
 *   node scripts/seed-collections.mjs --project <id> [--dry-run] [--cleanup]
 */

const PLACEHOLDER_ID = '_schema';

// The 46 top-level collections, grouped by the phase that owns them.
const COLLECTIONS = {
  'Phase 1 — identity & teams': ['users', 'teams', 'memberships'],
  'Phase 2 — lifecycle, privacy, safety': [
    'invitations',
    'joinRequests',
    'teamPolicies',
    'notificationPreferences',
    'privacySettings',
    'userSettings',
    'accountDeletionRequests',
    'reports',
    'moderationCases',
    'auditEvents'
  ],
  'Phase 3 — tracker, calendar, files': [
    'tasks',
    'taskHistory',
    'taskComments',
    'projects',
    'goals',
    'events',
    'eventOccurrences',
    'notifications',
    'fileMetadata',
    'folders',
    'phase3Operations'
  ],
  'Release 1.1 — kanban': ['kanbanOperations'],
  'Phase 4 — chat': [
    'channels',
    'messages',
    'announcements',
    'announcementAcknowledgements',
    'channelReads',
    'channelMutes'
  ],
  'Phase 5 — questions, videos, polls': [
    'questions',
    'answers',
    'questionComments',
    'questionVotes',
    'savedQuestions',
    'videos',
    'videoFavorites',
    'videoWatchHistory',
    'polls',
    'pollVotes',
    'pollHistory'
  ]
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const projectId = value('project') ?? process.env.FIRESTORE_PROJECT_ID;
const dryRun = flag('dry-run');
const cleanup = flag('cleanup');

if (!projectId) {
  console.error('Missing --project <id> (or FIRESTORE_PROJECT_ID).');
  process.exit(1);
}

const all = Object.values(COLLECTIONS).flat();
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function accessToken() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('gcloud', ['auth', 'print-access-token']);
  return stdout.trim();
}

function placeholderBody() {
  return {
    fields: {
      _placeholder: { booleanValue: true },
      teamId: { stringValue: '_schema' },
      createdAt: { timestampValue: new Date().toISOString() },
      note: {
        stringValue:
          'Inert placeholder so the collection exists. Safe to delete: node scripts/seed-collections.mjs --project <id> --cleanup'
      }
    }
  };
}

async function run() {
  console.log(`${cleanup ? 'Removing placeholders from' : 'Creating'} ${all.length} collections in ${projectId}`);
  if (dryRun) {
    for (const [group, names] of Object.entries(COLLECTIONS)) {
      console.log(`\n  ${group}`);
      for (const name of names) console.log(`    ${name}/${PLACEHOLDER_ID}`);
    }
    console.log('\nDry run — nothing written.');
    return;
  }

  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let ok = 0;
  const failures = [];

  for (const [group, names] of Object.entries(COLLECTIONS)) {
    console.log(`\n  ${group}`);
    for (const name of names) {
      const url = `${base}/${name}/${PLACEHOLDER_ID}`;
      const response = cleanup
        ? await fetch(url, { method: 'DELETE', headers })
        : await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(placeholderBody()) });

      // A cleanup pass over an already-clean database reports 404; that is success.
      if (response.ok || (cleanup && response.status === 404)) {
        ok += 1;
        console.log(`    ✔ ${name}`);
      } else {
        const detail = await response.text();
        failures.push({ name, status: response.status, detail: detail.slice(0, 200) });
        console.log(`    ✘ ${name} (${response.status})`);
      }
    }
  }

  console.log(`\n${ok}/${all.length} succeeded.`);
  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  ${f.name} [${f.status}] ${f.detail}`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
