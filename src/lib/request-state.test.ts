import { describe, expect, it } from 'vitest';
import { getRequestState } from './request-state';

describe('request state mapping', () => {
  it('maps connectivity failures to a retryable offline state', () => {
    expect(getRequestState({ code: 'functions/unavailable' }, true)).toMatchObject({ variant: 'offline' });
    expect(getRequestState(new Error('request failed'), false)).toMatchObject({ variant: 'offline' });
  });

  it('maps authorization failures to a plain-language permission state', () => {
    expect(getRequestState({ code: 'permission-denied' }, true)).toMatchObject({ variant: 'permission' });
  });

  it('does not sell a project misconfiguration as a missing team permission', () => {
    // auth/unauthorized-domain contains "unauthorized" and
    // auth/operation-not-allowed contains "operation-not-allowed", so both used
    // to land on the permission panel and tell the user to ask a coach.
    expect(getRequestState({ code: 'auth/unauthorized-domain' }, true)).toMatchObject({ variant: 'error' });
    expect(getRequestState({ code: 'auth/operation-not-allowed' }, true)).toMatchObject({ variant: 'error' });
    expect(getRequestState({ code: 'auth/configuration-not-found' }, true)).toMatchObject({ variant: 'error' });
  });

  it('still treats a genuine storage authorization failure as a permission state', () => {
    expect(getRequestState({ code: 'storage/unauthorized' }, true)).toMatchObject({ variant: 'permission' });
  });

  it('preserves useful messages for unknown failures', () => {
    expect(getRequestState(new Error('The server is unavailable.'), true)).toMatchObject({
      variant: 'error',
      message: 'The server is unavailable.'
    });
  });
});
