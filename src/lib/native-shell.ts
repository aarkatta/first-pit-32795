import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * True inside the Capacitor iOS shell.
 *
 * The shell runs the same bundle from a `capacitor://` origin, where a popup
 * has no opener to post back to, so the sign-in flow has to differ. Wrapped in
 * a try/catch because `Capacitor` is a web shim in a plain browser and must
 * never be the reason sign-in fails.
 */
export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Tag the document root with `native-shell` inside the iOS shell, so CSS can
 * tune the app for iOS alone (larger bottom-nav labels) without touching the
 * web. A no-op in a browser.
 */
export function markNativeShell(root: HTMLElement = document.documentElement): void {
  if (isNativeShell()) root.classList.add('native-shell');
}

/**
 * Match the iOS status bar text to the app theme. Capacitor's `Style.Dark` means
 * light text for a dark background. A no-op on the web, and a plugin failure is
 * cosmetic, so it is swallowed rather than surfaced.
 */
export async function syncNativeStatusBar(theme: 'light' | 'dark'): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
  } catch {
    // Cosmetic only.
  }
}

/**
 * Hide the launch splash once the web view has painted. `capacitor.config.ts`
 * also caps the splash duration, so a bundle that never reaches this call still
 * shows the page (or its error) instead of a splash that never ends.
 */
export async function hideNativeSplash(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // The duration cap hides it anyway.
  }
}
