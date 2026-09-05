import { describe, expect, it } from 'vitest';
import { phase5OperationReceipt, pollAudienceIncludesRole, pollResultsAreVisible, sanitizePollForList, searchTokens, validateVote } from '../src/phase5.js';

describe('phase 5 validation', () => {
  it('creates bounded, normalized search tokens', () => {
    expect(searchTokens('Programming Sensors', 'programming')).toEqual(['programming', 'sensors']);
    expect(searchTokens('a x robot')).toEqual(['robot']);
  });

  it('enforces single and multiple poll choice constraints', () => {
    const poll = {
      status: 'open',
      selection: 'single',
      options: [{ id: 'option-1' }, { id: 'option-2' }]
    };
    expect(validateVote(poll, ['option-1'])).toEqual(['option-1']);
    expect(() => validateVote(poll, ['option-1', 'option-2'])).toThrow('exactly one');
    expect(() => validateVote(poll, ['option-3'])).toThrow('not part');
    expect(() => validateVote({ ...poll, status: 'closed' }, ['option-1'])).toThrow('closed');
  });

  it('removes poll aggregates until the configured result boundary is satisfied', () => {
    const poll = { id: 'poll-1', status: 'open', resultsVisibility: 'afterClose', totalVotes: 4, optionVoteCounts: { 'option-1': 4 } };
    expect(pollResultsAreVisible(poll, true, false)).toBe(false);
    expect(sanitizePollForList(poll, false)).toEqual(expect.objectContaining({ id: 'poll-1', resultsVisible: false }));
    expect(sanitizePollForList(poll, false)).not.toHaveProperty('totalVotes');
    expect(sanitizePollForList(poll, false)).not.toHaveProperty('optionVoteCounts');
    expect(pollResultsAreVisible({ ...poll, status: 'closed' }, false, false)).toBe(true);
    expect(sanitizePollForList(poll, true)).toMatchObject({ totalVotes: 4, optionVoteCounts: { 'option-1': 4 }, resultsVisible: true });
    expect(pollResultsAreVisible({ ...poll, resultsVisibility: 'never' }, true, false)).toBe(false);
  });

  it('uses one role-audience boundary before result timing or admin override', () => {
    expect(pollAudienceIncludesRole(['coach'], 'coach')).toBe(true);
    expect(pollAudienceIncludesRole(['student'], 'coach')).toBe(false);
    expect(pollAudienceIncludesRole(['parent'], 'parent')).toBe(true);
    expect(pollAudienceIncludesRole(undefined, 'student')).toBe(false);

    const afterClose = { status: 'open', resultsVisibility: 'afterClose' };
    expect(pollResultsAreVisible(afterClose, false, true)).toBe(true);
    expect(pollResultsAreVisible(afterClose, false, false)).toBe(false);
  });

  it('replays a knowledge receipt only for its own author, scope, and operation kind', () => {
    const comment = { teamId: 'team-1', createdBy: 'student-1', kind: 'question-comment.create', questionId: 'question-1', commentId: 'comment-1' };
    expect(phase5OperationReceipt(comment, { teamId: 'team-1', actorUserId: 'student-1', kind: 'question-comment.create' })).toBe(comment);
    expect(() => phase5OperationReceipt(comment, { teamId: 'team-2', actorUserId: 'student-1', kind: 'question-comment.create' })).toThrow(/different knowledge operation/i);
    expect(() => phase5OperationReceipt(comment, { teamId: 'team-1', actorUserId: 'student-2', kind: 'question-comment.create' })).toThrow(/different knowledge operation/i);
    // Reusing one operation id across two commands must not skip the second one.
    expect(() => phase5OperationReceipt(comment, { teamId: 'team-1', actorUserId: 'student-1', kind: 'answer.create' })).toThrow(/different knowledge operation/i);

    // Community content has no team, so an absent teamId and an explicit null
    // are the same scope.
    const community = { createdBy: 'student-1', kind: 'question.create', questionId: 'question-2' };
    expect(phase5OperationReceipt(community, { teamId: null, actorUserId: 'student-1', kind: 'question.create' })).toBe(community);
    expect(() => phase5OperationReceipt(community, { teamId: 'team-1', actorUserId: 'student-1', kind: 'question.create' })).toThrow(/different knowledge operation/i);
  });
});
