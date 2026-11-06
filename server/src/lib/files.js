/**
 * Upload type checks. The type is read from the file's own first bytes, never
 * from what the client says, so a renamed executable is not stored as a PDF.
 */

/** JPEG, PNG or WebP, else null. Same rule as the profile photo (routes/me.js). */
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** A document upload: a PDF or one of the image types. */
export function sniffDocument(buf) {
  if (buf.length > 4 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  return sniffImage(buf)
}

/** Base64 (bare or a data: URL) to bytes. */
export const fromBase64 = s => Buffer.from(String(s).replace(/^data:[^,]*,/, ''), 'base64')
