import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOnlineStatus } from './use-online-status';

function OnlineStatusProbe() {
  const online = useOnlineStatus();

  return <output role="status">{online ? 'online' : 'offline'}</output>;
}

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setOnlineStatus(true);
});

describe('useOnlineStatus', () => {
  it('tracks online and offline events', () => {
    setOnlineStatus(true);
    render(<OnlineStatusProbe />);
    expect(screen.getByRole('status')).toHaveTextContent('online');

    setOnlineStatus(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('status')).toHaveTextContent('offline');

    setOnlineStatus(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.getByRole('status')).toHaveTextContent('online');
  });

  it('does not miss a transition during subscription setup', () => {
    setOnlineStatus(true);
    const originalAddEventListener = window.addEventListener.bind(window);
    const addEventListener = vi.spyOn(window, 'addEventListener');
    let offlineDispatched = false;
    addEventListener.mockImplementation((type, listener, options) => {
      originalAddEventListener(type, listener, options);

      if (type === 'online' && !offlineDispatched) {
        offlineDispatched = true;
        setOnlineStatus(false);
        window.dispatchEvent(new Event('offline'));
      }
    });

    render(<OnlineStatusProbe />);

    expect(screen.getByRole('status')).toHaveTextContent('offline');
  });
});
