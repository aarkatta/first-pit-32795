import { describe, expect, it } from 'vitest';
import { initialKnowledgeTab } from './knowledge-tabs';

const tabFor = (query: string) => initialKnowledgeTab(new URLSearchParams(query));

describe('initialKnowledgeTab', () => {
  it('opens on Resources by default', () => {
    expect(tabFor('')).toBe('resources');
    expect(tabFor('tab=unknown')).toBe('resources');
  });

  it('honours an explicit tab, then the tab a deep link points into', () => {
    expect(tabFor('tab=polls')).toBe('polls');
    expect(tabFor('tab=questions&question=q-1')).toBe('questions');
    expect(tabFor('question=q-1')).toBe('questions');
    expect(tabFor('poll=p-1')).toBe('polls');
  });

  it('keeps old How-to Videos links on Questions', () => {
    expect(tabFor('tab=videos')).toBe('questions');
    expect(tabFor('video=v-1')).toBe('questions');
    expect(tabFor('tab=videos&video=v-1')).toBe('questions');
  });
});
