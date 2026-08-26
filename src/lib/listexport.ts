import type { ListItem } from '../types';

// Items are written in markdown so they render nicely in-app, but an order
// email wants plain text — nobody wants to read `**Bestway**` in their inbox.
export function plainItem(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)') // links → "label (url)"
    .replace(/[*`_#]/g, '')
    .replace(/^\s*[-•]\s*/, '') // it's already going into a bulleted line
    .replace(/\s+/g, ' ')
    .trim();
}

const today = () =>
  new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export interface ExportSection {
  title: string;
  items: ListItem[];
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// mailto: URLs have no formal length limit, but real mail clients do, and
// they truncate *silently* — you'd send a half order and not notice. Past
// this we hand the body over via the clipboard instead. Conservative on
// purpose: a wrongly-sent short order costs more than an extra paste.
const MAILTO_BODY_LIMIT = 1800;

export interface MailtoPlan {
  url: string;
  /** True when the body was too long to embed and is on the clipboard. */
  viaClipboard: boolean;
}

export function buildMailto(to: string, subject: string, body: string): MailtoPlan {
  // The address goes in raw. Percent-encoding it turns `@` into `%40`, which
  // some mail clients hand back as a literal — and it's a delimiter, not
  // data, so it shouldn't be encoded anyway. looksLikeEmail() has already
  // ruled out whitespace and anything else that would need escaping.
  const addr = to.trim();
  const encodedBody = encodeURIComponent(body);
  const head = `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=`;
  if (encodedBody.length <= MAILTO_BODY_LIMIT) {
    return { url: head + encodedBody, viaClipboard: false };
  }
  return {
    url: head + encodeURIComponent('The order list is on your clipboard — paste it here.'),
    viaClipboard: true,
  };
}

// Builds the pasteable order. Callers pass only OPEN items: a checked-off
// item is one you've already dealt with, and re-ordering it would be the
// expensive kind of mistake. Section headings appear only when there's more
// than one, so a single list stays a clean flat list.
export function buildOrderText(
  heading: string,
  teamName: string,
  sections: ExportSection[],
  now: () => string = today
): string {
  const lines: string[] = [`${heading} — ${teamName}`, now(), ''];
  let count = 0;
  const multi = sections.filter((s) => s.items.length > 0).length > 1;
  for (const s of sections) {
    if (s.items.length === 0) continue;
    if (multi) lines.push(s.title);
    for (const i of s.items) {
      lines.push(`- ${plainItem(i.text)}`);
      count++;
    }
    if (multi) lines.push('');
  }
  lines.push('', `${count} item${count === 1 ? '' : 's'}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
