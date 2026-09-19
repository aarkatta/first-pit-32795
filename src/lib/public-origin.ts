import { isNativeShell } from './native-shell';

/**
 * The origin of the First Pit website, for URLs that leave the app: invite
 * links sent to families, and the continue URL in verification and
 * password-reset emails.
 *
 * On the web that is the page's own origin. In the iOS shell the page runs at
 * `capacitor://localhost`, which is useless in an email and which Firebase
 * rejects as a continue URL, so the shell uses the configured public site
 * instead (`VITE_PUBLIC_WEB_ORIGIN`, required by scripts/ios-bundle-check.mjs).
 */
export function publicWebOrigin(
  options: { native?: boolean; configured?: string; pageOrigin?: string } = {}
): string {
  const native = options.native ?? isNativeShell();
  const pageOrigin = options.pageOrigin ?? window.location.origin;
  if (!native) return pageOrigin;
  const configured = options.configured ?? (import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string | undefined);
  try {
    const url = new URL(configured ?? '');
    if (url.protocol === 'https:') return url.origin;
  } catch {
    // Fall through to the error below.
  }
  throw new Error('VITE_PUBLIC_WEB_ORIGIN must be an https:// origin in the iOS build.');
}
