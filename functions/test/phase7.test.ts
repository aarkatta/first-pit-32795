import { describe, expect, it } from 'vitest';
import { summarizeUnreadNotifications } from '../src/phase7.js';

describe('Phase 7 truthful bounded notification summary', () => {
  it('labels message/announcement counts as truncated at the read boundary', () => {
    const records = [
      { type: 'chat.message.created' },
      { type: 'chat.announcement.created' },
      ...Array.from({ length: 48 }, () => ({ type: 'task.updated' }))
    ];
    expect(summarizeUnreadNotifications(records)).toEqual({
      unreadMessageCount: 2,
      announcementCount: 1,
      unreadSummaryTruncated: true,
      unreadSummaryLimit: 50
    });
  });
});
