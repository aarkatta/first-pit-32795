import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  setStyle: vi.fn(),
  hide: vi.fn()
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: mocks.setStyle },
  Style: { Dark: 'DARK', Light: 'LIGHT' }
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: mocks.hide } }));

import { hideNativeSplash, isNativeShell, syncNativeStatusBar } from './native-shell';

describe('native shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.setStyle.mockResolvedValue(undefined);
    mocks.hide.mockResolvedValue(undefined);
  });

  it('reports the web as not native, including when the shim throws', () => {
    mocks.isNativePlatform.mockReturnValue(false);
    expect(isNativeShell()).toBe(false);
    mocks.isNativePlatform.mockImplementation(() => { throw new Error('no bridge'); });
    expect(isNativeShell()).toBe(false);
  });

  it('uses light status bar text on the dark theme and dark text on the light theme', async () => {
    await syncNativeStatusBar('dark');
    expect(mocks.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    await syncNativeStatusBar('light');
    expect(mocks.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });

  it('does not touch native plugins on the web', async () => {
    mocks.isNativePlatform.mockReturnValue(false);
    await syncNativeStatusBar('dark');
    await hideNativeSplash();
    expect(mocks.setStyle).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
  });

  it('hides the splash in the shell and swallows plugin failures', async () => {
    await hideNativeSplash();
    expect(mocks.hide).toHaveBeenCalledOnce();
    mocks.hide.mockRejectedValue(new Error('gone'));
    mocks.setStyle.mockRejectedValue(new Error('gone'));
    await expect(hideNativeSplash()).resolves.toBeUndefined();
    await expect(syncNativeStatusBar('light')).resolves.toBeUndefined();
  });
});
