import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import {
  assertTeamAdminInTransaction,
  auditRecord,
  getInput,
  isReplayOfOwnCreate,
  requireString,
  requireText,
  requireTeamAdmin,
  requireTeamId,
  requireTeamMember
} from './phase2.js';
import {
  MAX_CARDS_PER_COLUMN_PAGE,
  MAX_COLUMNS_PER_PROJECT,
  MAX_PROJECTS_PER_TEAM,
  MIN_COLUMNS_PER_PROJECT,
  ORDER_STEP,
  entityId,
  inputRecord,
  operationId,
  operationRef,
  projectCategories,
  projectColumns,
  requireProject,
  statusForColumn,
  MAX_CATEGORIES_PER_PROJECT,
  type ProjectCategory,
  type ProjectColumn
} from './kanban.js';

type TemplateRequest = CallableRequest<Record<string, unknown>>;

export type TemplateCard = {
  columnId: string;
  categoryId: string | null;
  title: string;
  description: string;
  priority: string;
  labels: string[];
};

export type ProjectTemplate = {
  id: string;
  source: 'builtIn' | 'team';
  name: string;
  description: string;
  columns: ProjectColumn[];
  categories: ProjectCategory[];
  completedColumnId: string;
  cards: TemplateCard[];
};

/**
 * A built-in template is addressed by a prefixed id so one callable can resolve
 * both catalogues. Firestore auto-ids are alphanumeric, so a saved template can
 * never collide with the prefix — but a caller-supplied id is rejected anyway.
 */
export const BUILT_IN_TEMPLATE_PREFIX = 'builtin:';
export const MAX_TEMPLATES_PER_TEAM = 12;
/** A template seeds a board, it does not carry a season. Keep the transaction small. */
export const MAX_TEMPLATE_CARDS = 40;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

function card(columnId: string, title: string, description = '', priority: typeof TASK_PRIORITIES[number] = 'medium', labels: string[] = [], categoryId: string | null = null): TemplateCard {
  return { columnId, categoryId, title, description, priority, labels };
}

/**
 * A built-in preset's categories; `areaId` keeps the dashboard progress bars
 * fed. A template never carries a milestone: milestones are this team's, this
 * season's, and a stale one would point a seeded board at nothing.
 */
function category(id: string, name: string, color: string, areaId: string | null = null): ProjectCategory {
  return { id, name, color, areaId, goalId: null };
}

/**
 * The starter catalogue. These describe the *process* an FLL team runs — the
 * season's own missions, rubrics, and materials are FIRST's to publish, so no
 * template ships season content; a coach renames the cards to match the season
 * in a couple of minutes. Mirrors the reasoning behind the scorer's starter
 * definition.
 */
export const BUILT_IN_PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}robot-game`,
    source: 'builtIn',
    name: 'Robot game',
    description: 'Build, program, and test loop for robot-game work.',
    columns: [
      { id: 'ideas', name: 'Ideas', color: 'slate' },
      { id: 'building', name: 'Building', color: 'blue' },
      { id: 'programming', name: 'Programming', color: 'purple' },
      { id: 'testing', name: 'Testing', color: 'orange' },
      { id: 'completed', name: 'Done', color: 'green' }
    ],
    completedColumnId: 'completed',
    categories: [
      category('strategy', 'Mission strategy', 'blue', 'robot-game'),
      category('build', 'Build', 'purple', 'robot-design'),
      category('code', 'Programming', 'orange', 'robot-design'),
      category('testing', 'Testing', 'green', 'robot-game')
    ],
    cards: [
      card('ideas', 'Choose the missions to attempt this run', 'List the missions the team wants in one match run and the order to attempt them.', 'high', ['robot-game', 'strategy'], 'strategy'),
      card('ideas', 'Sketch attachment ideas', 'One sketch per attachment idea, with what it has to grab or push.', 'medium', ['robot-design', 'design'], 'build'),
      card('building', 'Build the base robot', 'Drive base, motors, and sensor mounts that every attachment will reuse.', 'high', ['robot-design', 'build'], 'build'),
      card('building', 'Build the first attachment', '', 'medium', ['robot-design', 'build'], 'build'),
      card('programming', 'Program a straight, repeatable drive', 'Calibrate wheel distance so the same program lands in the same place twice.', 'high', ['robot-design', 'code'], 'code'),
      card('programming', 'Program the first mission run', '', 'medium', ['robot-game', 'code'], 'code'),
      card('testing', 'Run the mission ten times and record failures', 'Repeatability matters more than a single good run. Note what varies.', 'high', ['robot-game', 'test'], 'testing')
    ]
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}innovation-project`,
    source: 'builtIn',
    name: 'Innovation project',
    description: 'Research, design, and share stages for the innovation project.',
    columns: [
      { id: 'research', name: 'Research', color: 'blue' },
      { id: 'design', name: 'Design', color: 'purple' },
      { id: 'build', name: 'Prototype', color: 'orange' },
      { id: 'feedback', name: 'Feedback', color: 'pink' },
      { id: 'completed', name: 'Ready to share', color: 'green' }
    ],
    completedColumnId: 'completed',
    categories: [
      category('problem', 'Problem research', 'blue', 'innovation-project'),
      category('solution', 'Solution design', 'purple', 'innovation-project'),
      category('sharing', 'Sharing and feedback', 'pink', 'core-values')
    ],
    cards: [
      card('research', 'Define the problem in one sentence', 'Who has the problem, and what happens today because it is unsolved?', 'high', ['innovation-project', 'research'], 'problem'),
      card('research', 'Find three existing solutions', 'What already exists, and where does each one fall short?', 'medium', ['innovation-project', 'research'], 'problem'),
      card('research', 'Interview someone affected by the problem', 'A coach or mentor arranges the contact. Record notes, not names.', 'medium', ['innovation-project', 'research'], 'problem'),
      card('design', 'Draft the solution idea', '', 'high', ['innovation-project', 'design'], 'solution'),
      card('build', 'Build a prototype or model', 'A drawing, a slide, or a physical model — enough to show the idea.', 'medium', ['innovation-project', 'build'], 'solution'),
      card('feedback', 'Share with a mentor and record the feedback', '', 'medium', ['innovation-project', 'feedback'], 'sharing'),
      card('feedback', 'Revise the solution from the feedback', '', 'medium', ['innovation-project'], 'sharing')
    ]
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}season-plan`,
    source: 'builtIn',
    name: 'Season plan',
    description: 'Week-by-week planning board for the whole season.',
    columns: [
      { id: 'backlog', name: 'Backlog', color: 'slate' },
      { id: 'thisWeek', name: 'This week', color: 'blue' },
      { id: 'inProgress', name: 'In progress', color: 'purple' },
      { id: 'blocked', name: 'Blocked', color: 'orange' },
      { id: 'completed', name: 'Done', color: 'green' }
    ],
    completedColumnId: 'completed',
    categories: [
      category('team', 'Team and logistics', 'slate', 'core-values'),
      category('robot', 'Robot work', 'blue', 'robot-game'),
      category('project', 'Innovation project', 'purple', 'innovation-project'),
      category('presenting', 'Presentations', 'pink', 'core-values')
    ],
    cards: [
      card('thisWeek', 'Agree on the team meeting schedule', 'Days, times, and who confirms with parents.', 'high', ['logistics'], 'team'),
      card('thisWeek', 'Assign team roles', 'Who leads build, code, project, and presentation work.', 'high', ['core-values', 'roles'], 'team'),
      card('backlog', 'Plan the practice-match schedule', '', 'medium', ['logistics'], 'robot'),
      card('backlog', 'Prepare the team presentation outline', '', 'medium', ['presentation'], 'presenting'),
      card('backlog', 'Book the tournament travel and equipment list', '', 'low', ['logistics'], 'team')
    ]
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}tournament-prep`,
    source: 'builtIn',
    name: 'Tournament prep',
    description: 'Checklist board for the last weeks before a tournament.',
    columns: [
      { id: 'todo', name: 'To do', color: 'blue' },
      { id: 'inProgress', name: 'In progress', color: 'purple' },
      { id: 'packed', name: 'Packed or rehearsed', color: 'orange' },
      { id: 'completed', name: 'Done', color: 'green' }
    ],
    completedColumnId: 'completed',
    categories: [
      category('rehearsal', 'Rehearsals', 'purple', 'core-values'),
      category('packing', 'Packing', 'orange'),
      category('travel', 'Travel and paperwork', 'slate')
    ],
    cards: [
      card('todo', 'Rehearse the robot-game presentation', '', 'high', ['robot-design', 'presentation'], 'rehearsal'),
      card('todo', 'Rehearse the innovation-project presentation', '', 'high', ['innovation-project', 'presentation'], 'rehearsal'),
      card('todo', 'Practise judging questions as a team', '', 'medium', ['core-values', 'presentation'], 'rehearsal'),
      card('todo', 'Pack the robot, attachments, and spare parts', 'Spare motors, cables, and a charged battery set.', 'high', ['logistics'], 'packing'),
      card('todo', 'Print the engineering notebook and team sign', '', 'medium', ['logistics'], 'packing'),
      card('todo', 'Confirm arrival time, parking, and pit location', '', 'medium', ['logistics'], 'travel')
    ]
  }
];

export function isBuiltInTemplateId(templateId: string) {
  return templateId.startsWith(BUILT_IN_TEMPLATE_PREFIX);
}

export function findBuiltInTemplate(templateId: string): ProjectTemplate | null {
  return BUILT_IN_PROJECT_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

/**
 * Columns arriving from a saved template doc get the same shape check a live
 * project's workflow gets, plus the bounds `createProject` enforces: a template
 * written before a limit changed must not be able to seed a board that the
 * column commands would then refuse to edit.
 */
export function normalizeTemplateColumns(value: unknown): ProjectColumn[] {
  const columns = projectColumns({ columns: value });
  if (columns.length < MIN_COLUMNS_PER_PROJECT || columns.length > MAX_COLUMNS_PER_PROJECT) {
    throw new HttpsError('failed-precondition', `A template must define between ${MIN_COLUMNS_PER_PROJECT} and ${MAX_COLUMNS_PER_PROJECT} columns.`);
  }
  if (new Set(columns.map((column) => column.id)).size !== columns.length) {
    throw new HttpsError('failed-precondition', 'A template cannot repeat a column.');
  }
  return columns;
}

/**
 * A template's categories get the same shape check a live board's do, plus the
 * board bound. Ids are kept as written so the template's cards can point at
 * them; a duplicate id would make that ambiguous, so it is rejected.
 */
export function normalizeTemplateCategories(value: unknown): ProjectCategory[] {
  // Milestones are dropped rather than copied: see `category` above.
  const categories = projectCategories({ categories: value }).map((entry) => ({ ...entry, goalId: null }));
  if (categories.length > MAX_CATEGORIES_PER_PROJECT) {
    throw new HttpsError('failed-precondition', `A template can define at most ${MAX_CATEGORIES_PER_PROJECT} categories.`);
  }
  if (new Set(categories.map((entry) => entry.id)).size !== categories.length) {
    throw new HttpsError('failed-precondition', 'A template cannot repeat a category.');
  }
  return categories;
}

export function normalizeCompletedColumnId(value: unknown, columns: ProjectColumn[]): string {
  const requested = typeof value === 'string' ? value : '';
  return columns.some((column) => column.id === requested) ? requested : columns[columns.length - 1].id;
}

/**
 * Cards are dropped rather than rejected when they name a column the template no
 * longer has: a half-usable template still seeds a board, and a coach who edited
 * the workflow after saving should not be locked out of their own template.
 */
export function normalizeTemplateCards(value: unknown, columns: ProjectColumn[], categories: ProjectCategory[] = []): TemplateCard[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TEMPLATE_CARDS) {
    throw new HttpsError('failed-precondition', `A template can hold at most ${MAX_TEMPLATE_CARDS} cards.`);
  }
  const columnIds = new Set(columns.map((column) => column.id));
  const categoryIds = new Set(categories.map((entry) => entry.id));
  const perColumn = new Map<string, number>();
  const cards: TemplateCard[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const columnId = typeof record.columnId === 'string' ? record.columnId : '';
    if (!columnIds.has(columnId)) continue;
    const used = perColumn.get(columnId) ?? 0;
    if (used >= MAX_CARDS_PER_COLUMN_PAGE) continue;
    perColumn.set(columnId, used + 1);
    cards.push({
      columnId,
      // An unknown category is dropped to null for the same reason an unknown
      // column drops the card: the template still has to seed a usable board.
      categoryId: typeof record.categoryId === 'string' && categoryIds.has(record.categoryId) ? record.categoryId : null,
      title: requireText(record.title, 'Template card title', 160),
      description: record.description === undefined || record.description === null || record.description === ''
        ? ''
        : requireText(record.description, 'Template card description', 4000),
      priority: TASK_PRIORITIES.includes(record.priority as typeof TASK_PRIORITIES[number]) ? String(record.priority) : 'medium',
      labels: Array.isArray(record.labels) ? record.labels.slice(0, 20).map((label) => requireString(label, 'Template card label', 40)) : []
    });
  }
  return cards;
}

export function parseStoredTemplate(id: string, data: Record<string, unknown>): ProjectTemplate {
  const columns = normalizeTemplateColumns(data.columns);
  const categories = normalizeTemplateCategories(data.categories);
  return {
    id,
    source: 'team',
    name: requireText(data.name, 'Template name', 80),
    description: typeof data.description === 'string' && data.description ? data.description.slice(0, 1000) : '',
    columns,
    categories,
    completedColumnId: normalizeCompletedColumnId(data.completedColumnId, columns),
    cards: normalizeTemplateCards(data.cards, columns, categories)
  };
}

/** Cards land in the order the template lists them, spaced like every other board. */
export function templateCardOrderKeys(cards: TemplateCard[]): number[] {
  const perColumn = new Map<string, number>();
  return cards.map((entry) => {
    const index = (perColumn.get(entry.columnId) ?? 0) + 1;
    perColumn.set(entry.columnId, index);
    return index * ORDER_STEP;
  });
}

async function readTeamTemplates(teamId: string) {
  const snapshot = await getFirestore()
    .collection('projectTemplates')
    .where('teamId', '==', teamId)
    .orderBy('createdAt', 'asc')
    .limit(MAX_TEMPLATES_PER_TEAM)
    .get();
  return snapshot.docs.map((document) => parseStoredTemplate(document.id, document.data() as Record<string, unknown>));
}

/**
 * Read-only. Built-in templates live in server code, so the picker cannot read
 * them from Firestore; serving both catalogues from one callable is what keeps
 * the client from carrying a second, drifting copy of the definitions.
 */
export const listProjectTemplates = async (request: TemplateRequest) => {
  const teamId = requireTeamId(request);
  await requireTeamMember(request, teamId);
  return { builtIn: BUILT_IN_PROJECT_TEMPLATES, team: await readTeamTemplates(teamId) };
};

export const createProjectFromTemplate = async (request: TemplateRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const templateId = requireString(input.templateId, 'Template ID', 160);
  const overrideName = input.name === undefined || input.name === null || input.name === '' ? null : requireString(input.name, 'Project name', 80);
  const includeCards = input.includeCards !== false;
  const db = getFirestore();
  const projectId = entityId(input, 'projectId', 'project', db.collection('projects').doc().id);
  const projectRef = db.doc(`projects/${projectId}`);
  const opRef = operationRef(teamId, operationId(input, 'createProjectFromTemplate'));

  const builtIn = isBuiltInTemplateId(templateId);
  const template = builtIn ? findBuiltInTemplate(templateId) : parseStoredTemplate(templateId, await (async () => {
    const snapshot = await db.doc(`projectTemplates/${templateId}`).get();
    const data = snapshot.data();
    if (!snapshot.exists || data?.teamId !== teamId) throw new HttpsError('not-found', 'Template not found in this team.');
    return data as Record<string, unknown>;
  })());
  if (!template) throw new HttpsError('not-found', 'Template not found.');

  const columns = normalizeTemplateColumns(template.columns);
  const categories = normalizeTemplateCategories(template.categories);
  const completedColumnId = normalizeCompletedColumnId(template.completedColumnId, columns);
  const cards = includeCards ? normalizeTemplateCards(template.cards, columns, categories) : [];
  const orderKeys = templateCardOrderKeys(cards);
  const cardRefs = cards.map(() => db.collection('tasks').doc());

  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const [existing, operation, activeProjects] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(opRef),
      transaction.get(db.collection('projects').where('teamId', '==', teamId).where('archived', '==', false).limit(MAX_PROJECTS_PER_TEAM))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Project')) return;
    if (activeProjects.size >= MAX_PROJECTS_PER_TEAM) throw new HttpsError('resource-exhausted', `A team can have at most ${MAX_PROJECTS_PER_TEAM} active projects.`);
    const now = FieldValue.serverTimestamp();
    transaction.set(projectRef, {
      id: projectId,
      teamId,
      createdBy: admin.uid,
      name: overrideName ?? template.name,
      description: template.description,
      columns,
      categories,
      completedColumnId,
      archived: false,
      version: 1,
      templateId,
      createdAt: now,
      updatedAt: now
    });
    cards.forEach((entry, index) => {
      const ref = cardRefs[index];
      const completed = entry.columnId === completedColumnId;
      transaction.set(ref, {
        id: ref.id,
        teamId,
        createdBy: admin.uid,
        projectId,
        columnId: entry.columnId,
        categoryId: entry.categoryId,
        orderKey: orderKeys[index],
        version: 1,
        title: entry.title,
        description: entry.description,
        status: statusForColumn(entry.columnId, completedColumnId),
        priority: entry.priority,
        assignedTo: null,
        watcherUserIds: [],
        goalId: null,
        labels: entry.labels,
        checklist: [],
        subtasks: [],
        attachmentFileIds: [],
        dueAt: null,
        completedAt: completed ? now : null,
        historyCount: 1,
        createdAt: now,
        updatedAt: now
      });
      transaction.set(db.collection('taskHistory').doc(), {
        id: ref.id,
        teamId,
        createdBy: admin.uid,
        taskId: ref.id,
        actorUserId: admin.uid,
        action: 'created',
        changedFields: ['created', 'projectId', 'columnId'],
        createdAt: now,
        updatedAt: now
      });
    });
    transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'project.createFromTemplate', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetResource: `projects/${projectId}`,
      metadata: { action: 'kanban.project.createdFromTemplate' }
    }));
  });
  return { projectId, templateId, cardCount: cards.length };
};

export const saveProjectAsTemplate = async (request: TemplateRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const input = inputRecord(request);
  const projectId = requireString(input.projectId, 'Project ID', 128);
  const name = requireText(input.name, 'Template name', 80);
  const description = input.description === undefined || input.description === null || input.description === ''
    ? ''
    : requireText(input.description, 'Template description', 1000);
  const includeCards = input.includeCards !== false;
  const db = getFirestore();
  const templateId = entityId(input, 'templateId', 'template', db.collection('projectTemplates').doc().id);
  if (isBuiltInTemplateId(templateId)) throw new HttpsError('invalid-argument', 'That template ID is reserved.');
  const templateRef = db.doc(`projectTemplates/${templateId}`);
  const opRef = operationRef(teamId, operationId(input, 'saveProjectAsTemplate'));

  // Cards are read outside the transaction: a template is a snapshot of the
  // board, not a consistent view of it, and a transactional read of every card
  // would contend with the moves happening on the board at the same time.
  const cardSnapshot = includeCards
    ? await db.collection('tasks').where('teamId', '==', teamId).where('projectId', '==', projectId).orderBy('orderKey', 'asc').limit(MAX_TEMPLATE_CARDS).get()
    : null;

  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const [existing, operation, saved] = await Promise.all([
      transaction.get(templateRef),
      transaction.get(opRef),
      transaction.get(db.collection('projectTemplates').where('teamId', '==', teamId).limit(MAX_TEMPLATES_PER_TEAM))
    ]);
    if (isReplayOfOwnCreate(existing, operation, { teamId, actorUserId: admin.uid }, 'Template')) return;
    if (saved.size >= MAX_TEMPLATES_PER_TEAM) throw new HttpsError('resource-exhausted', `A team can save at most ${MAX_TEMPLATES_PER_TEAM} templates. Delete one first.`);
    const project = requireProject(await transaction.get(db.doc(`projects/${projectId}`)), teamId);
    const columns = normalizeTemplateColumns(project.columns);
    const categories = normalizeTemplateCategories(project.categories);
    const completedColumnId = normalizeCompletedColumnId(project.completedColumnId, columns);
    const cards = normalizeTemplateCards(
      (cardSnapshot?.docs ?? []).map((document) => {
        const data = document.data();
        return { columnId: data.columnId, categoryId: data.categoryId, title: data.title, description: data.description, priority: data.priority, labels: data.labels };
      }),
      columns,
      categories
    );
    const now = FieldValue.serverTimestamp();
    transaction.set(templateRef, {
      id: templateId,
      teamId,
      createdBy: admin.uid,
      name,
      description,
      columns,
      categories,
      completedColumnId,
      cards,
      cardCount: cards.length,
      sourceProjectId: projectId,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(opRef, { teamId, createdBy: admin.uid, kind: 'project.saveAsTemplate', createdAt: now });
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetResource: `projectTemplates/${templateId}`,
      metadata: { action: 'kanban.template.created' }
    }));
  });
  return { templateId, projectId, cardCount: cardSnapshot?.size ?? 0 };
};

export const deleteProjectTemplate = async (request: TemplateRequest) => {
  const teamId = requireTeamId(request);
  const admin = await requireTeamAdmin(request, teamId);
  const templateId = requireString(getInput(request, 'templateId'), 'Template ID', 160);
  if (isBuiltInTemplateId(templateId)) throw new HttpsError('failed-precondition', 'Built-in templates cannot be deleted.');
  const db = getFirestore();
  await db.runTransaction(async (transaction) => {
    await assertTeamAdminInTransaction(transaction, teamId, admin);
    const ref = db.doc(`projectTemplates/${templateId}`);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.teamId !== teamId) throw new HttpsError('not-found', 'Template not found in this team.');
    transaction.delete(ref);
    transaction.set(db.collection('auditEvents').doc(), auditRecord({
      type: 'administrative.action',
      actorUserId: admin.uid,
      teamId,
      targetResource: `projectTemplates/${templateId}`,
      metadata: { action: 'kanban.template.deleted' }
    }));
  });
  return { templateId, deleted: true as const };
};
