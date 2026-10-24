#!/usr/bin/env node
/**
 * Set a team's FIRST program: `fll` (every team's default) or `ftc`.
 *
 * FTC is not offered in the app this season, so this is the only way a team
 * becomes FTC. The program decides two things (see `functions/src/programs.ts`):
 * the plan a team's first board is seeded with, and the areas its dashboard
 * tracks. The change writes `teams/{teamId}.program` and a `sensitive.updated`
 * audit event with action `team.program.<program>`, in one atomic commit. The
 * team update carries an `updateTime` precondition, so a rename in the app
 * between the read and the write fails the commit instead of being overwritten.
 *
 * A team's board is left exactly as it is. A team whose board already exists
 * keeps its tasks; its dashboard switches at once, and a coach can bring in the
 * other program's plan from Tracker → Import with that program's template. To
 * have a new FTC team's board seeded with the FTC plan, run this before anyone
 * opens its Tracker.
 *
 * Auth uses the caller's gcloud access token — no service-account key needed:
 *   gcloud auth login          # once, as an owner/editor of the project
 *
 * With FIRESTORE_EMULATOR_HOST set, it talks to the local emulator instead, as
 * its owner (rules bypassed, no gcloud needed):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/set-team-program.mjs --project demo-first-pit-dev --team "My team" --program ftc --apply
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   node scripts/set-team-program.mjs --project first-pit-32795 --team "NC FTC Apex" --program ftc
 *   node scripts/set-team-program.mjs --project first-pit-32795 --team "NC FTC Apex" --program ftc --apply
 *
 * Options:
 *   --team <name>          team name, exactly as shown in the app
 *   --team-id <id>         the team's document ID, instead of --team
 *   --program <fll|ftc>    the program to set
 *   --actor-email <email>  coach recorded as the actor in the audit log
 *                          (default: the team's creator); must be an active
 *                          coach or team leader on the team
 *   --apply                write the change
 */

import { randomBytes } from 'node:crypto';

const PROGRAMS = ['fll', 'ftc'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const projectId = value('project');
const teamName = value('team');
const teamIdArg = value('team-id');
const program = value('program');
const actorEmail = value('actor-email');
const apply = flag('apply');

if (!projectId || (!teamName && !teamIdArg) || !PROGRAMS.includes(program)) {
  console.error('Usage: node scripts/set-team-program.mjs --project <id> (--team <name> | --team-id <id>) --program <fll|ftc> [--actor-email <email>] [--apply]');
  process.exit(1);
}

const root = `projects/${projectId}/databases/(default)/documents`;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const base = emulatorHost ? `http://${emulatorHost}/v1/${root}` : `https://firestore.googleapis.com/v1/${root}`;
let headers;

async function accessToken() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('gcloud', ['auth', 'print-access-token']);
  return stdout.trim();
}

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${response.status}\n${(await response.text()).slice(0, 500)}`);
  return response.json();
}

/** Firestore REST `fields` → a plain object (strings, numbers, booleans, null are enough here). */
function decode(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    if ('stringValue' in field) return [key, field.stringValue];
    if ('booleanValue' in field) return [key, field.booleanValue];
    if ('integerValue' in field) return [key, Number(field.integerValue)];
    if ('nullValue' in field) return [key, null];
    return [key, undefined];
  }));
}

const docId = (name) => name.slice(name.lastIndexOf('/') + 1);

/** Equality-only query over one collection. */
async function query(collectionId, equals) {
  const filters = Object.entries(equals).map(([path, stringValue]) => ({
    fieldFilter: { field: { fieldPath: path }, op: 'EQUAL', value: { stringValue } }
  }));
  const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
  const rows = await request(`${base}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where, limit: 200 } })
  });
  return rows.filter((row) => row.document).map((row) => ({
    id: docId(row.document.name),
    name: row.document.name,
    updateTime: row.document.updateTime,
    data: decode(row.document.fields)
  }));
}

async function getDoc(path) {
  const response = await fetch(`${base}/${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  const doc = await response.json();
  return { id: docId(doc.name), name: doc.name, updateTime: doc.updateTime, data: decode(doc.fields) };
}

async function resolveTeam() {
  if (teamIdArg) {
    const team = await getDoc(`teams/${teamIdArg}`);
    if (!team) throw new Error(`No team with ID ${teamIdArg}.`);
    return team;
  }
  const teams = await query('teams', { name: teamName });
  if (teams.length === 1) return teams[0];
  if (teams.length === 0) throw new Error(`No team named "${teamName}". Check the spelling, or pass --team-id.`);
  throw new Error(`${teams.length} teams are named "${teamName}" (${teams.map((t) => t.id).join(', ')}). Pass --team-id.`);
}

async function resolveActor(team) {
  let uid = team.data.createdBy;
  if (actorEmail) {
    const users = await query('users', { email: actorEmail });
    if (users.length !== 1) throw new Error(`Expected one user with email ${actorEmail}, found ${users.length}.`);
    uid = users[0].id;
  }
  if (!uid) throw new Error('The team has no creator on record. Pass --actor-email.');
  const membership = await getDoc(`memberships/${team.id}_${uid}`);
  const isActiveAdmin = membership?.data.status === 'active' && ['coach', 'teamLeader'].includes(membership.data.role);
  if (!isActiveAdmin) throw new Error(`${actorEmail ?? uid} is not an active coach on this team. Pass --actor-email for one who is.`);
  const user = await getDoc(`users/${uid}`);
  return { uid, label: user?.data.displayName ?? user?.data.email ?? uid };
}

function autoId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join('');
}

const serverTime = (fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' });

function writesFor(team, actorUid) {
  return [
    {
      update: { name: team.name, fields: { program: { stringValue: program } } },
      updateMask: { fieldPaths: ['program'] },
      updateTransforms: [serverTime('updatedAt')],
      currentDocument: { updateTime: team.updateTime }
    },
    {
      // Mirrors auditRecord({ type: 'sensitive.updated', ... }); audit metadata
      // carries only allow-listed keys, so the program rides in `action`.
      update: {
        name: `${root}/auditEvents/${autoId()}`,
        fields: {
          type: { stringValue: 'sensitive.updated' },
          actorUserId: { stringValue: actorUid },
          teamId: { stringValue: team.id },
          targetResource: { stringValue: `teams/${team.id}` },
          metadata: { mapValue: { fields: { action: { stringValue: `team.program.${program}` } } } }
        }
      },
      updateTransforms: [serverTime('createdAt')],
      currentDocument: { exists: false }
    }
  ];
}

async function run() {
  // The emulator treats the bearer token "owner" as an admin.
  headers = { Authorization: `Bearer ${emulatorHost ? 'owner' : await accessToken()}`, 'Content-Type': 'application/json' };

  const team = await resolveTeam();
  // A team written before programs existed has no field, and reads as FLL.
  const current = team.data.program === 'ftc' ? 'ftc' : 'fll';
  console.log(`Team: ${team.data.name} (${team.id}) in ${projectId}${emulatorHost ? ` on the emulator at ${emulatorHost}` : ''}`);
  console.log(`Program: ${current}${team.data.program === undefined ? ' (no field; the default)' : ''} → ${program}`);

  const board = await getDoc(`projects/default_${team.id}`);
  if (board) {
    console.log('\nThis team already has a board. It is left exactly as it is; only the dashboard switches.');
    console.log(`A coach can add the ${program.toUpperCase()} plan from Tracker → Import with the ${program.toUpperCase()} template.`);
  } else {
    console.log(`\nNo board yet: the first time a coach opens the Tracker, it is seeded with the ${program.toUpperCase()} plan.`);
  }

  if (current === program && team.data.program === program) {
    console.log(`\nAlready ${program}. Nothing to do.`);
    return;
  }

  const actor = await resolveActor(team);
  console.log(`\nAudit actor: ${actor.label} (${actor.uid})`);

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to set the program to "${program}".`);
    return;
  }

  await request(`${base}:commit`, {
    method: 'POST',
    body: JSON.stringify({ writes: writesFor(team, actor.uid) })
  });
  console.log(`\nDone: ${team.data.name} is now ${program.toUpperCase()}, with an audit event.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
