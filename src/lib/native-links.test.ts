import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNativeShell: vi.fn(),
  open: vi.fn(),
  writeFile: vi.fn(),
  share: vi.fn(),
  reportError: vi.fn()
}));

vi.mock('./native-shell', () => ({ isNativeShell: mocks.isNativeShell }));
vi.mock('./report-error', () => ({ reportError: mocks.reportError }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: mocks.writeFile }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));

import { classifyLink, installNativeLinkHandler, runLinkAction, shareText } from './native-links';

const APP = window.location.origin;

function anchor(attributes: Record<string, string>): HTMLAnchorElement {
  const element = document.createElement('a');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

describe('classifyLink', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('sends other sites to the in-app browser', () => {
    expect(classifyLink(anchor({ href: 'https://www.firstlegoleague.org/', target: '_blank' }), APP))
      .toEqual({ kind: 'external', url: 'https://www.firstlegoleague.org/' });
  });

  it('leaves in-app routes, hashes, mailto and empty links alone', () => {
    expect(classifyLink(anchor({ href: '/coordination' }), APP)).toEqual({ kind: 'none' });
    expect(classifyLink(anchor({ href: '#how' }), APP)).toEqual({ kind: 'none' });
    expect(classifyLink(anchor({ href: 'mailto:coach@example.com' }), APP)).toEqual({ kind: 'none' });
    expect(classifyLink(anchor({}), APP)).toEqual({ kind: 'none' });
  });

  it('treats download links as downloads, named by the attribute or the path', () => {
    expect(classifyLink(anchor({ href: '/first-pit-task-template.xlsx', download: '' }), APP))
      .toEqual({ kind: 'download', url: `${APP}/first-pit-task-template.xlsx`, fileName: 'first-pit-task-template.xlsx' });
    expect(classifyLink(anchor({ href: 'data:text/csv,a%2Cb', download: 'tasks.csv' }), APP))
      .toMatchObject({ kind: 'download', fileName: 'tasks.csv' });
    expect(classifyLink(anchor({ href: 'data:text/csv,a', download: '' }), APP))
      .toMatchObject({ kind: 'download', fileName: 'download' });
  });

  it('keeps a download name inside the cache directory', () => {
    expect(classifyLink(anchor({ href: '/x.csv', download: '../../etc/passwd' }), APP))
      .toMatchObject({ fileName: '-..-etc-passwd' });
  });
});

describe('runLinkAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeFile.mockResolvedValue({ uri: 'file:///cache/tasks.csv' });
    mocks.share.mockResolvedValue(undefined);
  });

  it('opens external links in the in-app browser', async () => {
    await runLinkAction({ kind: 'external', url: 'https://example.com/' });
    expect(mocks.open).toHaveBeenCalledWith({ url: 'https://example.com/' });
  });

  it('writes a download to the cache and offers it through the share sheet', async () => {
    await runLinkAction({ kind: 'download', url: 'data:text/csv;base64,YSxi', fileName: 'tasks.csv' });
    expect(mocks.writeFile).toHaveBeenCalledWith({ path: 'tasks.csv', data: 'YSxi', directory: 'CACHE' });
    expect(mocks.share).toHaveBeenCalledWith({ title: 'tasks.csv', files: ['file:///cache/tasks.csv'] });
  });

  it('treats a dismissed share sheet as done, and rethrows real failures', async () => {
    mocks.share.mockRejectedValueOnce(new Error('Share canceled'));
    await expect(runLinkAction({ kind: 'download', url: 'data:text/csv,a', fileName: 'a.csv' })).resolves.toBeUndefined();
    mocks.share.mockRejectedValueOnce(new Error('No activity'));
    await expect(runLinkAction({ kind: 'download', url: 'data:text/csv,a', fileName: 'a.csv' })).rejects.toThrow('No activity');
  });
});

describe('installNativeLinkHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { document.body.innerHTML = ''; });

  function click(element: Element) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    element.dispatchEvent(event);
    return event;
  }

  it('does nothing on the web', () => {
    mocks.isNativeShell.mockReturnValue(false);
    const uninstall = installNativeLinkHandler();
    const event = click(anchor({ href: 'https://example.com/', target: '_blank' }));
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
    uninstall();
  });

  it('intercepts external links in the shell, including clicks on their children', () => {
    mocks.isNativeShell.mockReturnValue(true);
    mocks.open.mockResolvedValue(undefined);
    const uninstall = installNativeLinkHandler();
    const link = anchor({ href: 'https://example.com/file.pdf', target: '_blank' });
    const label = document.createElement('span');
    link.append(label);

    expect(click(label).defaultPrevented).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith({ url: 'https://example.com/file.pdf' });
    uninstall();
  });

  it('leaves in-app links and already-handled clicks to the page', () => {
    mocks.isNativeShell.mockReturnValue(true);
    const uninstall = installNativeLinkHandler();
    // Registered after the handler, so it sees the handler's decision; then it
    // stops jsdom from attempting the navigation it cannot perform.
    let preventedByHandler: boolean | null = null;
    const observe = (event: Event) => { preventedByHandler = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener('click', observe);
    click(anchor({ href: '/team' }));
    document.removeEventListener('click', observe);
    expect(preventedByHandler).toBe(false);

    const handled = anchor({ href: 'https://example.com/' });
    handled.addEventListener('click', (event) => event.preventDefault());
    click(handled);
    expect(mocks.open).not.toHaveBeenCalled();
    uninstall();
  });

  it('reports a failed action instead of leaving a silent rejection', async () => {
    mocks.isNativeShell.mockReturnValue(true);
    mocks.open.mockRejectedValue(new Error('no browser'));
    const uninstall = installNativeLinkHandler();
    click(anchor({ href: 'https://example.com/' }));
    await vi.waitFor(() => expect(mocks.reportError).toHaveBeenCalled());
    uninstall();
  });
});

describe('shareText', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shares text and reports a dismissal as false', async () => {
    mocks.share.mockResolvedValueOnce(undefined);
    await expect(shareText({ title: 'Invite', text: 'Join us' })).resolves.toBe(true);
    expect(mocks.share).toHaveBeenCalledWith({ title: 'Invite', text: 'Join us' });
    mocks.share.mockRejectedValueOnce(new Error('Share canceled'));
    await expect(shareText({ title: 'Invite', text: 'Join us' })).resolves.toBe(false);
    mocks.share.mockRejectedValueOnce(new Error('broken'));
    await expect(shareText({ title: 'Invite', text: 'Join us' })).rejects.toThrow('broken');
  });
});
