import { describe, expect, it } from 'vitest';
import { PROGRAM_AREAS, PROGRAM_TEMPLATE_HREF, applyProgramTheme, teamProgram } from './programs';

describe('team programs', () => {
  it('treats a team with no program, or anything but ftc, as FLL', () => {
    expect(teamProgram(null)).toBe('fll');
    expect(teamProgram({})).toBe('fll');
    expect(teamProgram({ program: 'fll' })).toBe('fll');
    expect(teamProgram({ program: 'ftc' })).toBe('ftc');
  });

  it('keeps the FLL areas the dashboard has always shown, and seven FTC awards', () => {
    expect(PROGRAM_AREAS.fll.map((area) => area.id)).toEqual(['innovation-project', 'robot-design', 'robot-game', 'core-values']);
    expect(PROGRAM_AREAS.ftc.map((area) => area.id)).toEqual(['think', 'control', 'design', 'innovate', 'connect', 'sustain', 'reach']);
    expect(PROGRAM_TEMPLATE_HREF.fll).toBe('/first-pit-task-template.xlsx');
  });
});

describe('applyProgramTheme', () => {
  it('marks the page for an FTC team and clears the mark for FLL', () => {
    const root = document.createElement('html');
    applyProgramTheme('ftc', root);
    expect(root.dataset.program).toBe('ftc');
    applyProgramTheme('fll', root);
    expect(root.hasAttribute('data-program')).toBe(false);
  });
});
