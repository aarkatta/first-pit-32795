import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNativeShell } from './native-shell';
import { reportError } from './report-error';

/**
 * Links in the iOS shell.
 *
 * The pages use ordinary anchors: `target="_blank"` for other sites (team
 * files, the official scoresheet, Knowledge resources) and `download` for
 * generated files (the import template and CSV starter). A WKWebView honours
 * neither. A download navigates the app itself onto the file, with no way
 * back, and another site leaves the app for Safari. Rather than branch every
 * page, one click handler in the shell routes those anchors to the in-app
 * Safari view or the share sheet, and the web keeps its plain links.
 */
export type LinkAction =
  | { kind: 'none' }
  | { kind: 'external'; url: string }
  | { kind: 'download'; url: string; fileName: string };

export function classifyLink(anchor: HTMLAnchorElement, appOrigin: string): LinkAction {
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return { kind: 'none' };
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return { kind: 'none' };
  }
  if (anchor.hasAttribute('download')) {
    return { kind: 'download', url: url.href, fileName: downloadFileName(anchor, url) };
  }
  // mailto:, tel: and in-app routes are left alone: Capacitor hands the first
  // two to iOS, and the router owns the rest.
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== appOrigin) {
    return { kind: 'external', url: url.href };
  }
  return { kind: 'none' };
}

function downloadFileName(anchor: HTMLAnchorElement, url: URL): string {
  const named = anchor.getAttribute('download')?.trim();
  if (named) return safeFileName(named);
  const last = url.protocol === 'data:' ? '' : decodeURIComponent(url.pathname.split('/').pop() ?? '');
  return safeFileName(last || 'download');
}

/** Keeps the name inside the cache directory: no path separators or parent refs. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\]/g, '-').replace(/^\.+/, '');
  return cleaned || 'download';
}

/** The share sheet reports its own dismissal as an error; it is not one. */
function isShareCancel(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message);
}

export async function runLinkAction(action: LinkAction): Promise<void> {
  if (action.kind === 'external') {
    await Browser.open({ url: action.url });
    return;
  }
  if (action.kind === 'download') {
    const blob = await (await fetch(action.url)).blob();
    const { uri } = await Filesystem.writeFile({
      path: action.fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache
    });
    try {
      await Share.share({ title: action.fileName, files: [uri] });
    } catch (error) {
      if (!isShareCancel(error)) throw error;
    }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    // A data URL; Filesystem wants only the base64 payload after the comma.
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

/**
 * Installs the shell's link handler and returns its uninstaller; a no-op on the
 * web. It listens in the bubble phase on `document`, after React's root
 * listener, so a component that handles its own click (and calls
 * `preventDefault`) is never overridden.
 */
export function installNativeLinkHandler(target: Document = document): () => void {
  if (!isNativeShell()) return () => undefined;
  const listener = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const action = classifyLink(anchor, target.defaultView?.location.origin ?? '');
    if (action.kind === 'none') return;
    event.preventDefault();
    runLinkAction(action).catch((error: unknown) => reportError(error));
  };
  target.addEventListener('click', listener);
  return () => target.removeEventListener('click', listener);
}

/**
 * Share text through the iOS share sheet (Mail, Messages, Gmail, AirDrop…).
 * Resolves `false` when the user dismisses the sheet.
 */
export async function shareText(input: { title: string; text: string }): Promise<boolean> {
  try {
    await Share.share({ title: input.title, text: input.text });
    return true;
  } catch (error) {
    if (isShareCancel(error)) return false;
    throw error;
  }
}
