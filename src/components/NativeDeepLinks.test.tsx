import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigateTo: null as ((path: string) => void) | null,
  stop: vi.fn()
}));

vi.mock('@/lib/native-deep-links', () => ({
  listenForDeepLinks: (navigate: (path: string) => void) => {
    mocks.navigateTo = navigate;
    return mocks.stop;
  }
}));

import { act } from 'react';
import { NativeDeepLinks } from './NativeDeepLinks';

function CurrentPath() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

describe('NativeDeepLinks', () => {
  it('routes a deep link through the router and unsubscribes on unmount', () => {
    const { getByRole, unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <NativeDeepLinks />
        <CurrentPath />
      </MemoryRouter>
    );
    act(() => mocks.navigateTo?.('/join?invite=abc'));
    expect(getByRole('status').textContent).toBe('/join?invite=abc');
    unmount();
    expect(mocks.stop).toHaveBeenCalled();
  });
});
