import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativeShell: vi.fn(),
  getLaunchUrl: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
  listener: null as ((event: { url: string }) => void) | null
}));

vi.mock('./native-shell', () => ({ isNativeShell: mocks.isNativeShell }));
vi.mock('./public-origin', () => ({ publicWebOrigin: () => 'https://www.first-pit.com' }));
vi.mock('@capacitor/app', () => ({ App: { getLaunchUrl: mocks.getLaunchUrl, addListener: mocks.addListener } }));

import { appPathFromUrl, listenForDeepLinks } from './native-deep-links';

const SITE = 'https://www.first-pit.com';

describe('appPathFromUrl', () => {
  it('maps our own links to in-app routes, keeping query and hash', () => {
    expect(appPathFromUrl(`${SITE}/join?invite=abc123`, SITE)).toBe('/join?invite=abc123');
    expect(appPathFromUrl(`${SITE}/coordination?task=t1#details`, SITE)).toBe('/coordination?task=t1#details');
    expect(appPathFromUrl(`${SITE}/`, SITE)).toBe('/');
  });

  it('ignores other sites, look-alike hosts and malformed URLs', () => {
    expect(appPathFromUrl('https://evil.example/join?invite=abc', SITE)).toBeNull();
    expect(appPathFromUrl('https://www.first-pit.com.evil.example/join', SITE)).toBeNull();
    expect(appPathFromUrl('http://www.first-pit.com/join', SITE)).toBeNull();
    expect(appPathFromUrl('not a url', SITE)).toBeNull();
  });
});

describe('listenForDeepLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativeShell.mockReturnValue(true);
    mocks.getLaunchUrl.mockResolvedValue(undefined);
    mocks.addListener.mockImplementation((_event: string, callback: (event: { url: string }) => void) => {
      mocks.listener = callback;
      return Promise.resolve({ remove: mocks.remove });
    });
  });

  it('does nothing on the web', () => {
    mocks.isNativeShell.mockReturnValue(false);
    const navigate = vi.fn();
    listenForDeepLinks(navigate)();
    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the link that cold-started the app', async () => {
    mocks.getLaunchUrl.mockResolvedValue({ url: `${SITE}/join?invite=cold` });
    const navigate = vi.fn();
    const stop = listenForDeepLinks(navigate);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/join?invite=cold'));
    stop();
  });

  it('navigates for links that open the running app, and ignores foreign ones', async () => {
    const navigate = vi.fn();
    const stop = listenForDeepLinks(navigate);
    mocks.listener?.({ url: `${SITE}/files` });
    mocks.listener?.({ url: 'https://example.com/files' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/files');
    stop();
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalled());
  });

  it('stops navigating once unsubscribed, even for a late launch URL', async () => {
    let resolveLaunch: (value: { url: string }) => void = () => undefined;
    mocks.getLaunchUrl.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));
    const navigate = vi.fn();
    const stop = listenForDeepLinks(navigate);
    stop();
    resolveLaunch({ url: `${SITE}/team` });
    mocks.listener?.({ url: `${SITE}/team` });
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
  });
});
