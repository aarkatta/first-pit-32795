import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_RESOURCES } from './knowledge-resources';

describe('KNOWLEDGE_RESOURCES', () => {
  it('lists each resource once with a title, description and https link', () => {
    expect(new Set(KNOWLEDGE_RESOURCES.map((resource) => resource.id)).size).toBe(KNOWLEDGE_RESOURCES.length);
    for (const resource of KNOWLEDGE_RESOURCES) {
      expect(resource.title.trim()).not.toBe('');
      expect(resource.description.trim()).not.toBe('');
      expect(new URL(resource.url).protocol).toBe('https:');
    }
  });
});
