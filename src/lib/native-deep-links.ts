import { App } from '@capacitor/app';
import { isNativeShell } from './native-shell';
import { publicWebOrigin } from './public-origin';

/**
 * Universal Links: a `https://www.first-pit.com/...` link tapped on an iPhone
 * with the app installed opens the app instead of Safari (see
 * `public/.well-known/apple-app-site-association`). iOS hands the full URL to
 * the app; the web routes are the app's routes, so the path, query and hash
 * are the in-app destination (`/join?invite=…`, `/coordination?task=…`).
 */
export function appPathFromUrl(url: string, publicOrigin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only our own site: anything else is not an in-app destination.
  if (parsed.origin !== publicOrigin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Calls `navigate` for the link that launched the app and for every later one
 * that brings it to the front. Returns an unsubscribe function; a no-op on the
 * web.
 */
export function listenForDeepLinks(navigate: (path: string) => void): () => void {
  if (!isNativeShell()) return () => undefined;
  let active = true;
  const open = (url: string | undefined) => {
    if (!active || !url) return;
    const path = appPathFromUrl(url, publicWebOrigin());
    if (path) navigate(path);
  };

  // A cold start from a link: the event fired before this listener existed.
  void App.getLaunchUrl().then((launch) => open(launch?.url)).catch(() => undefined);
  const handle = App.addListener('appUrlOpen', (event) => open(event.url));

  return () => {
    active = false;
    void handle.then((listener) => listener.remove());
  };
}
