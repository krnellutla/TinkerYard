// What a receipt upload may be. Pure, so it's easy to test; used by the page (before sending) and the
// server (before reading or storing). Receipts can now be opened by everyone in a group, so only
// plain image and PDF types are kept: an SVG or HTML file would run as a script on our own domain.

export const MAX_UPLOAD = 4 * 1024 * 1024; // Vercel refuses request bodies over ~4.5 MB

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] as const;

export type UploadCheck = { ok: true } | { ok: false; status: 413 | 415; error: string };

export function acceptUpload(type: string, size: number): UploadCheck {
  const t = (type || "").toLowerCase().split(";")[0].trim();
  if (!(RECEIPT_TYPES as readonly string[]).includes(t)) return { ok: false, status: 415, error: "That file type isn't supported. Use a photo (JPEG, PNG, HEIC) or a PDF." };
  if (size > MAX_UPLOAD) return { ok: false, status: 413, error: "That file is too large (over 4 MB). Try a photo of the receipt instead." };
  return { ok: true };
}

// The bill row kept for a photo that couldn't be read: no lines, no amounts, just the picture.
export const ATTACHMENT_MODEL = "attachment";
