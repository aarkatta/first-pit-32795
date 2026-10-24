/**
 * The FIRST program a team competes in. It decides two things only: the plan a
 * team's first board is seeded with (`standard-plan.ts`) and the areas the
 * dashboard tracks progress by (`phase7.ts`).
 *
 * `teams/{teamId}.program` is written by `createTeam` (always `fll` for now)
 * and changed only from the backend (`scripts/set-team-program.mjs`); the
 * `teams` update rule keeps it out of the browser's reach. A team created
 * before the field existed has none, and reads as FLL.
 */
export const TEAM_PROGRAMS = ['fll', 'ftc'] as const;
export type TeamProgram = (typeof TEAM_PROGRAMS)[number];

/** Anything other than an exact `ftc` — including no field at all — is FLL. */
export function teamProgram(data: { program?: unknown } | undefined | null): TeamProgram {
  return data?.program === 'ftc' ? 'ftc' : 'fll';
}

/** FTC award groups: Machine, Creativity & Innovation, and Team Attribute. */
export type AreaGroup = 'mci' | 'ta';

export type ProgramArea = { id: string; label: string; group: AreaGroup | null };

/**
 * A task belongs to an area when it carries the area id as a label — the
 * seeded plan, the built-in templates and the task importer apply these, and
 * a coach can add one to any card. Labels rather than a new task field keep
 * every existing task, rule, and editor unchanged.
 */
export const PROGRAM_AREAS: Record<TeamProgram, readonly ProgramArea[]> = {
  // The four FIRST LEGO League judging areas.
  fll: [
    { id: 'innovation-project', label: 'Innovation project', group: null },
    { id: 'robot-design', label: 'Robot design', group: null },
    { id: 'robot-game', label: 'Robot game', group: null },
    { id: 'core-values', label: 'Core values', group: null }
  ],
  // The seven FIRST Tech Challenge judged awards (Inspire is the sum of them).
  ftc: [
    { id: 'think', label: 'Think', group: null },
    { id: 'control', label: 'Control', group: 'mci' },
    { id: 'design', label: 'Design', group: 'mci' },
    { id: 'innovate', label: 'Innovate', group: 'mci' },
    { id: 'connect', label: 'Connect', group: 'ta' },
    { id: 'sustain', label: 'Sustain', group: 'ta' },
    { id: 'reach', label: 'Reach', group: 'ta' }
  ]
};

/**
 * Every area id of every program: what a category or an imported row may be
 * tied to. Validating against the union spares a team read on every edit; an
 * id from the other program is simply not counted on this team's dashboard.
 */
export const ALL_AREA_IDS: readonly string[] = TEAM_PROGRAMS.flatMap((program) => PROGRAM_AREAS[program].map((area) => area.id));
