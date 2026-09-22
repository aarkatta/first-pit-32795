/**
 * Copies text, reporting whether it worked rather than throwing.
 *
 * Every caller has a fallback to show — the invite link, the starter password —
 * because the Clipboard API is unavailable over plain HTTP, in some embedded
 * webviews, and whenever the user has denied the permission. A copy that
 * silently failed used to leave a coach believing they had the link.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
