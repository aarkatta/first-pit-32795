import { env } from 'node:process';

const projectId = env.FIREBASE_PROJECT_ID ?? 'demo-first-pit-ci';
const authPort = env.AUTH_EMULATOR_PORT ?? '9099';
const functionsPort = env.FUNCTIONS_EMULATOR_PORT ?? '5001';
const firestorePort = env.FIRESTORE_EMULATOR_PORT ?? '8080';
const storagePort = env.STORAGE_EMULATOR_PORT ?? '9199';
const authBase = `http://127.0.0.1:${authPort}`;
const functionsBase = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const firestoreBase = `http://127.0.0.1:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;
const storageBucket = `${projectId}.appspot.com`;

async function requestJson(url, options = {}) {
  const response = await globalThis.fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function expectStatus(url, expectedStatus, label, options = {}) {
  const { response, body } = await requestJson(url, options);
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function createAuthUser(email) {
  const password = 'FoundationPass123!';
  const body = await expectStatus(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    200,
    `Auth signup for ${email}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  return { email, password, idToken: body.idToken, localId: body.localId };
}

async function teamLookupQueryBody(teamIds) {
  return {
    structuredQuery: {
      from: [{ collectionId: 'teams' }],
      where: {
        fieldFilter: {
          field: { fieldPath: '__name__' },
          op: 'IN',
          value: {
            arrayValue: {
              values: teamIds.map((teamId) => ({
                referenceValue: `projects/${projectId}/databases/(default)/documents/teams/${teamId}`
              }))
            }
          }
        }
      },
      limit: 10
    }
  };
}

const unauthenticatedFirestoreUrl = `${firestoreBase}/ci-verification/document`;
const unauthenticatedStorageUrl = `http://127.0.0.1:${storagePort}/v0/b/${storageBucket}/o/ci-verification.txt`;

function membershipQueryBody(userId) {
  return {
    structuredQuery: {
      from: [{ collectionId: 'memberships' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
            { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } } }
          ]
        }
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 50
    }
  };
}

await expectStatus(
  `${functionsBase}/api/healthz`,
  200,
  'Functions health check'
);
await expectStatus(unauthenticatedFirestoreUrl, 403, 'Unauthenticated Firestore read');
await expectStatus(unauthenticatedStorageUrl, 403, 'Unauthenticated Storage read');

const firstUser = await createAuthUser(`phase1-coach-${Date.now()}@example.com`);
const secondUser = await createAuthUser(`phase1-outsider-${Date.now()}@example.com`);
const firstUserToken = firstUser.idToken;
const secondUserToken = secondUser.idToken;
const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

const signedInFirstUser = await expectStatus(
  `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
  200,
  'Auth sign-in',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: firstUser.email, password: firstUser.password, returnSecureToken: true })
  }
);
if (signedInFirstUser.localId !== firstUser.localId) throw new Error('Auth sign-in returned the wrong user.');
await expectStatus(
  `${authBase}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`,
  200,
  'Auth password recovery request',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: firstUser.email })
  }
);

const firstUserProfileUrl = `${firestoreBase}/users/${firstUser.localId}`;
await expectStatus(firstUserProfileUrl, 200, 'Client profile bootstrap', {
  method: 'PATCH',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: {
      uid: { stringValue: firstUser.localId },
      email: { stringValue: firstUser.email },
      displayName: { stringValue: 'Profile Bootstrap' },
      photoURL: { nullValue: 'NULL_VALUE' },
      createdAt: { timestampValue: new Date().toISOString() },
      updatedAt: { timestampValue: new Date().toISOString() }
    }
  })
});
await expectStatus(firstUserProfileUrl, 403, 'Cross-user private profile read', { headers: authHeader(secondUserToken) });

const teamResponse = await expectStatus(
  `${functionsBase}/createTeam`,
  200,
  'Server-side team creation',
  {
    method: 'POST',
    headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { name: 'Phase 1 Verification Team' } })
  }
);
const teamData = teamResponse.data ?? teamResponse.result ?? teamResponse;
const teamId = teamData?.teamId;
if (!teamId) throw new Error(`Server-side team creation did not return a team ID: ${JSON.stringify(teamResponse)}`);
const auditEventId = teamData?.auditEventId;
if (!auditEventId) throw new Error('Server-side team creation did not return an audit event ID.');

const outsiderTeamResponse = await expectStatus(
  `${functionsBase}/createTeam`,
  200,
  'Second server-side team creation',
  {
    method: 'POST',
    headers: { ...authHeader(secondUserToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { name: 'Phase 1 Outsider Team' } })
  }
);
const outsiderTeamId = (outsiderTeamResponse.data ?? outsiderTeamResponse.result ?? outsiderTeamResponse)?.teamId;
if (!outsiderTeamId) throw new Error(`Second team creation did not return a team ID: ${JSON.stringify(outsiderTeamResponse)}`);

const teamUrl = `${firestoreBase}/teams/${teamId}`;
await expectStatus(teamUrl, 200, 'Authorized team read', { headers: authHeader(firstUserToken) });
await expectStatus(teamUrl, 403, 'Cross-team unauthorized team read', { headers: authHeader(secondUserToken) });
const policyDocument = await expectStatus(`${firestoreBase}/teamPolicies/${teamId}`, 200, 'Deferred team policy read', { headers: authHeader(firstUserToken) });
const policyFields = policyDocument.fields ?? {};
const expectedPolicy = {
  parentVisibility: 'none',
  directMessaging: 'disabled',
  contentAudience: 'teamOnly',
  membershipApproval: 'inviteOnly',
  fileSharing: 'disabled',
  discoverability: 'private'
};
for (const [field, expected] of Object.entries(expectedPolicy)) {
  if (policyFields[field]?.stringValue !== expected) throw new Error(`Policy field ${field} is not safely defaulted.`);
}
await expectStatus(teamUrl, 403, 'Cross-team client write denied', {
  method: 'PATCH',
  headers: { ...authHeader(secondUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { name: { stringValue: 'Unauthorized rename' } } })
});
const exactTeamLookup = await expectStatus(`${firestoreBase}:runQuery`, 200, 'Exact team document lookup', {
  method: 'POST',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify(await teamLookupQueryBody([teamId]))
});
const exactTeamIds = exactTeamLookup.filter((entry) => entry.document).map((entry) => entry.document.name.split('/').pop());
if (exactTeamIds.length !== 1 || exactTeamIds[0] !== teamId) throw new Error(`Exact team lookup returned unexpected documents: ${JSON.stringify(exactTeamIds)}`);
await expectStatus(`${firestoreBase}:runQuery`, 403, 'Mixed-team document lookup denied', {
  method: 'POST',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify(await teamLookupQueryBody([teamId, outsiderTeamId]))
});

await expectStatus(`${firestoreBase}/teamPolicies/${teamId}`, 403, 'Client policy update denied', {
  method: 'PATCH',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { teamId: { stringValue: teamId }, directMessaging: { stringValue: 'enabled' } } })
});
await expectStatus(`${firestoreBase}/teams/${teamId}/tasks/task-1`, 403, 'Future feature read denied', {
  headers: authHeader(firstUserToken)
});
await expectStatus(`${firestoreBase}/teams/${teamId}/tasks/task-1/comments/comment-1`, 403, 'Future subcollection read denied', {
  headers: authHeader(firstUserToken)
});

const membershipUrl = `${firestoreBase}/memberships/${teamId}_${firstUser.localId}`;
await expectStatus(membershipUrl, 200, 'Authorized membership read', { headers: authHeader(firstUserToken) });

await expectStatus(`${firestoreBase}/memberships/inactive-team_${firstUser.localId}`, 200, 'Emulator inactive membership fixture', {
  method: 'PATCH',
  headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: {
      teamId: { stringValue: 'inactive-team' },
      userId: { stringValue: firstUser.localId },
      role: { stringValue: 'student' },
      status: { stringValue: 'suspended' },
      createdAt: { timestampValue: new Date().toISOString() },
      updatedAt: { timestampValue: new Date().toISOString() }
    }
  })
});
const membershipQuery = await expectStatus(`${firestoreBase}:runQuery`, 200, 'Bounded active membership query', {
  method: 'POST',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify(membershipQueryBody(firstUser.localId))
});
const returnedMemberships = membershipQuery.filter((entry) => entry.document).map((entry) => entry.document.name.split('/').pop());
if (returnedMemberships.length !== 1 || returnedMemberships[0] !== `${teamId}_${firstUser.localId}`) {
  throw new Error(`Active membership query crossed a boundary or returned inactive data: ${JSON.stringify(returnedMemberships)}`);
}

await expectStatus(`${firestoreBase}/auditEvents/${auditEventId}`, 200, 'Authorized audit event read', { headers: authHeader(firstUserToken) });
await expectStatus(`${firestoreBase}/auditEvents/${auditEventId}`, 403, 'Unauthorized audit event read', { headers: authHeader(secondUserToken) });
await expectStatus(`${firestoreBase}/auditEvents`, 403, 'Client audit write denied', {
  method: 'POST',
  headers: { ...authHeader(firstUserToken), 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { type: { stringValue: 'sensitive.updated' }, actorUserId: { stringValue: firstUser.localId } } })
});

const teamStoragePath = encodeURIComponent(`teams/${teamId}/private.txt`);
await expectStatus(
  `http://127.0.0.1:${storagePort}/v0/b/${storageBucket}/o/${teamStoragePath}`,
  403,
  'Deferred Storage read',
  { headers: authHeader(firstUserToken) }
);
await expectStatus(
  `http://127.0.0.1:${storagePort}/v0/b/${storageBucket}/o/${teamStoragePath}`,
  403,
  'Unauthorized Storage lookup',
  { headers: authHeader(secondUserToken) }
);
await expectStatus(
  `http://127.0.0.1:${storagePort}/v0/b/${storageBucket}/o?uploadType=media&name=${teamStoragePath}`,
  403,
  'Client Storage write denied',
  { method: 'POST', headers: { ...authHeader(firstUserToken), 'Content-Type': 'text/plain' }, body: 'untrusted' }
);

globalThis.console.log('Phase 2 Auth, Functions, Firestore team boundaries, safe policies, audit logging, and Storage rules verification passed.');
