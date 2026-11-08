/**
 * card.js — the on-device one-page record card (WP3; Gates V-04, V-05).
 *
 * The card is generated entirely on the device as a standalone SVG document (one page,
 * 1080 × 1528, portrait). It contains: the verdict heading, the date, every check's state,
 * the mismatched or missing lines, any caution lines (flagged checks, including a
 * declined test, C4-P10), the educational frame, and the correction-log / Desk / Crypto
 * Basics link lines from the content map.
 *
 * Injection safety [Gate A03]: the card is built as text, so every value is XML-escaped
 * here (addresses, hashes, and user words included). The card contains no script, no
 * external reference, no font download, and no image fetch.
 *
 * Sharing [Gate V-05]: the caller passes the SVG to the device share sheet
 * (navigator.share with a File) or downloads it via a local blob: URL — only after an
 * explicit tap. Nothing is uploaded.
 *
 * Input `model` is already-resolved text: { title, heading, subjectLine, date, sections:
 * [{ label, lines: [string] }], frame, links: [string] }.
 */
export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** Naive width-based wrap; long unbroken values (hashes) are split hard. */
export function wrap(text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (w.length > max) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
      if ((line + ' ' + w).trim().length > max) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}

export const CARD_W = 1080;
export const CARD_H = 1528;

export function buildCardSvg(model) {
  const rows = [];
  let y = 90;
  const text = (s, size, fill, weight = 400, x = 60) => {
    rows.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escapeXml(s)}</text>`);
    y += Math.round(size * 1.35);
  };
  text(model.title, 34, '#2EF5A0', 700);
  y += 10;
  for (const l of wrap(model.heading, 34)) text(l, 52, '#FFFFFF', 700);
  if (model.subjectLine) for (const l of wrap(model.subjectLine, 60)) text(l, 28, '#FFFFFF');
  text(model.date, 26, '#C8C8C8');
  y += 10;
  for (const sec of model.sections) {
    if (!sec.lines.length) continue;
    text(sec.label, 30, '#2EF5A0', 700);
    for (const line of sec.lines) for (const l of wrap(line, 64)) { if (y > CARD_H - 260) break; text(l, 26, '#FFFFFF'); }
    y += 8;
  }
  y = Math.max(y, CARD_H - 240);
  for (const l of wrap(model.frame, 70)) text(l, 24, '#C8C8C8');
  for (const link of model.links) for (const l of wrap(link, 70)) text(l, 22, '#C8C8C8');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">\n<rect width="100%" height="100%" fill="#121212"/>\n<rect x="0" y="0" width="${CARD_W}" height="12" fill="#2EF5A0"/>\n${rows.join('\n')}\n</svg>\n`;
}
