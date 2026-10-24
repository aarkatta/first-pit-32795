import type { Team } from './domain';

/**
 * The FIRST program a team competes in. Mirrors `functions/src/programs.ts`:
 * it decides the plan a team's first board is seeded with and the areas the
 * dashboard tracks. Every team is FLL unless the backend set it to FTC
 * (`scripts/set-team-program.mjs`); the browser never writes it.
 */
export type TeamProgram = 'fll' | 'ftc';

/** Anything other than an exact `ftc` — including no field at all — is FLL. */
export function teamProgram(team: Pick<Team, 'program'> | null | undefined): TeamProgram {
  return team?.program === 'ftc' ? 'ftc' : 'fll';
}

/**
 * Marks the page with the active team's program, which `program-ftc.css`
 * turns into the Google-blue FTC theme. FLL is the default look, so it clears the
 * mark rather than setting one.
 */
export function applyProgramTheme(program: TeamProgram, root: HTMLElement = document.documentElement) {
  if (program === 'ftc') root.dataset.program = 'ftc';
  else delete root.dataset.program;
}

/** FTC award groups: Machine, Creativity & Innovation, and Team Attribute. */
export type AreaGroup = 'mci' | 'ta';

export type ProgramArea = { id: string; label: string; group: AreaGroup | null };

/** Mirrors `PROGRAM_AREAS` in functions/src/programs.ts; the server rejects any other id. */
export const PROGRAM_AREAS: Record<TeamProgram, readonly ProgramArea[]> = {
  fll: [
    { id: 'innovation-project', label: 'Innovation project', group: null },
    { id: 'robot-design', label: 'Robot design', group: null },
    { id: 'robot-game', label: 'Robot game', group: null },
    { id: 'core-values', label: 'Core values', group: null }
  ],
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

export const AREA_GROUP_HEADINGS: Record<AreaGroup, string> = {
  mci: 'Machine, Creativity & Innovation (MCI Awards)',
  ta: 'Team Attribute Awards (TA)'
};

/** The downloadable Excel plan for each program (`npm run template:build`). */
export const PROGRAM_TEMPLATE_HREF: Record<TeamProgram, string> = {
  fll: '/first-pit-task-template.xlsx',
  ftc: '/first-pit-ftc-task-template.xlsx'
};
