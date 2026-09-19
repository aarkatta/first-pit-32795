/** File types the server accepts for team files (`ALLOWED_FILE_TYPES` in functions/src/phase3.ts). */
export const ATTACHMENT_TYPES = ['application/pdf', 'text/plain', 'text/csv', 'application/zip', 'image/png', 'image/jpeg', 'image/webp'];
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',');
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Why a chosen file cannot be uploaded, or null when it can. */
export function attachmentProblem(file: File): string | null {
  if (!ATTACHMENT_TYPES.includes(file.type)) return `${file.name} can't be attached. Use a PDF, image (PNG, JPG, WebP), text, CSV or ZIP file.`;
  if (file.size < 1) return `${file.name} is empty.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than 10 MB.`;
  return null;
}
