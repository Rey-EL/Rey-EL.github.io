/**
 * camera.js — camera-first capture for Check 2 and Check 5, entirely on the device (WP6).
 *
 * INVARIANT (no-upload rule) [Spec §3 rule 3, §9] [Plan WP6, §4.2] [Gates C2-05, P-02]:
 * camera frames and photos are decoded in this browser tab and then discarded. This
 * module contains no fetch, XHR, WebSocket, sendBeacon or form submission; the image
 * never becomes a URL other than a local object URL that is revoked immediately.
 *
 * Decoding uses the browser's built-in, on-device Shape Detection API:
 *   - BarcodeDetector (QR codes)  — shipped in Chrome on Android; NOT in iPhone Safari.
 *   - TextDetector (printed text) — experimental; may be absent in every current browser.
 * No QR or OCR library is bundled (zero new dependencies; WP13 says remove unused
 * camera/QR/OCR packages). Where a detector is missing the app says so and offers
 * paste or manual entry; it never guesses [Gates C2-06, C2-08]. This limitation is
 * recorded in the WP14 handoff.
 *
 * Photo reading never guesses: it accepts a result only when exactly ONE address-shaped
 * token is found AND that token passes address validation. Zero or several candidates,
 * or one that fails its checksum or form (a likely crop) -> "could not read reliably"
 * (acceptPhotoText, Gate C2-06).
 */
import { classifyAddress } from '../core/address.js';
export const hasBarcodeDetector = () => typeof globalThis.BarcodeDetector === 'function';
export const hasTextDetector = () => typeof globalThis.TextDetector === 'function';
export const hasCamera = () => typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/** Address-shaped tokens (format only; real validation happens in address.js). */
const CANDIDATE = /(0x[0-9a-fA-F]{40}|\b(?:bc1|BC1)[0-9a-zA-Z]{8,87}\b|\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b)/g;

export function pickSingleCandidate(text) {
  const found = [...new Set(String(text).match(CANDIDATE) || [])];
  return found.length === 1 ? found[0] : null;
}

/**
 * acceptPhotoText(text) — the decision for a value read from a photo's printed text.
 * Resolves { ok: true, text } or { ok: false, cause: 'UNREADABLE' }.
 *
 * Gate C2-06 (fix-pass m5): CANDIDATE above is a shape filter only, so a cropped or
 * misread address can still fit the shape. When the single candidate then fails
 * address validation (checksum or form), the photo read itself cannot be told apart
 * from a crop, so it is reported as an unreliable read — Check 2 asks for a new photo
 * and keeps paste and manual entry (READ_UNRELIABLE) — instead of a checksum-failed
 * flag on characters the user never saw. Nothing is guessed or repaired: the candidate
 * is accepted exactly as read, or not at all. Values the user typed or pasted, and QR
 * contents (exact machine-readable data), are not routed here and keep their
 * checksum-failed flag from address.js.
 */
export function acceptPhotoText(text) {
  const one = pickSingleCandidate(text);
  if (!one || !classifyAddress(one).valid) return { ok: false, cause: 'UNREADABLE' };
  return { ok: true, text: one };
}

/**
 * Live QR scan. Starts the rear camera in `video`, polls the detector, stops the camera
 * as soon as a code is read or `signal` aborts. Resolves { ok, text } or { ok: false, cause }.
 * cause: UNSUPPORTED | DENIED | NO_CAMERA | ABORTED
 */
export async function scanQr(video, signal) {
  if (!hasCamera()) return { ok: false, cause: 'NO_CAMERA' };
  if (!hasBarcodeDetector()) return { ok: false, cause: 'UNSUPPORTED' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    return { ok: false, cause: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'DENIED' : 'NO_CAMERA' };
  }
  const stop = () => { stream.getTracks().forEach((tr) => tr.stop()); video.srcObject = null; };
  try {
    video.srcObject = stream;
    await video.play();
    const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
    while (!signal.aborted) {
      const codes = await detector.detect(video).catch(() => []);
      if (codes.length === 1) return { ok: true, text: codes[0].rawValue };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, cause: 'ABORTED' };
  } finally {
    stop(); // camera released; no frame retained
  }
}

/**
 * Photo of a written or displayed address (or a QR in a photo). Reads on the device and
 * discards the image. Resolves { ok, text, via } or { ok: false, cause }.
 * cause: UNSUPPORTED | UNREADABLE
 */
export async function readPhoto(file) {
  if (!hasBarcodeDetector() && !hasTextDetector()) return { ok: false, cause: 'UNSUPPORTED' };
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    if (hasBarcodeDetector()) {
      const codes = await new globalThis.BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap).catch(() => []);
      if (codes.length === 1) return { ok: true, text: codes[0].rawValue, via: 'qr' };
    }
    if (hasTextDetector()) {
      const blocks = await new globalThis.TextDetector().detect(bitmap).catch(() => []);
      const read = acceptPhotoText(blocks.map((b) => b.rawValue).join(' ')); // m5, Gate C2-06
      if (read.ok) return { ok: true, text: read.text, via: 'text' };
    }
    return { ok: false, cause: 'UNREADABLE' };
  } catch {
    return { ok: false, cause: 'UNREADABLE' };
  } finally {
    if (bitmap && bitmap.close) bitmap.close(); // discard image data after extraction [Plan WP6]
  }
}
