// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.

export interface PageMeta {
  url: string;
  title: string;
  description?: string;
  host?: string;
  favicon?: string;
  image?: string;
}

const URL_RE = /^https?:\/\/[^\s<>]+$/i;
const MAX_HTML = 300_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;

/** The URL in `text` when the whole text is one http(s) URL, otherwise null. */
export function asBareUrl(text: string): string | null {
  const t = text.trim();
  if (!URL_RE.test(t)) return null;
  try {
    const u = new URL(t);
    return u.hostname.includes('.') && !isPrivateHost(u.hostname) ? t : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** localhost, loopback, link-local and private ranges: pages we cannot read and should not probe. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) return h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** True for an http(s) address that is safe to request or to load an image from. */
export function isWebUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®',
  trade: '™', middot: '·', bull: '•', euro: '€', times: '×', eacute: 'é', egrave: 'è', aacute: 'á',
  iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

function clean(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).replace(/\s+$/, '') + '…' : t;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

function metaContent(head: string, keys: string[]): string | null {
  const wanted = new Set(keys);
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    if (!name || !wanted.has(name)) continue;
    const value = attr(tag, 'content');
    if (value && value.trim()) return value;
  }
  return null;
}

function resolve(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(decodeEntities(value.trim()), base);
    return isWebUrl(u.href) ? u.href : null;
  } catch {
    return null;
  }
}

function iconHref(head: string): string | null {
  let best: { href: string; rank: number } | null = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = attr(tag, 'href');
    if (!href || !rel.includes('icon')) continue;
    // `shortcut icon` and `icon` over the large touch icons.
    const rank = rel.includes('apple-touch-icon') ? 1 : 2;
    if (!best || rank > best.rank) best = { href, rank };
  }
  return best?.href ?? null;
}

/**
 * Card data from a page's HTML: Open Graph first, then Twitter cards, then the
 * plain `<title>` and meta description. `finalUrl` is where the request ended
 * up, which relative image and icon addresses are resolved against.
 */
export function extractCard(html: string, url: string, finalUrl: string = url): PageMeta | null {
  const head = html.slice(0, MAX_HTML).replace(/<!--[\s\S]*?-->/g, '');
  const plainTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title =
    clean(metaContent(head, ['og:title', 'twitter:title']), MAX_TITLE) ?? clean(plainTitle, MAX_TITLE) ?? null;
  if (!title) return null;
  const description = clean(metaContent(head, ['og:description', 'twitter:description', 'description']), MAX_DESCRIPTION);
  const image = resolve(metaContent(head, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']), finalUrl);
  const favicon = resolve(iconHref(head) ?? '/favicon.ico', finalUrl);
  const meta: PageMeta = { url, title, host: hostOf(url) };
  if (description) meta.description = description;
  if (favicon) meta.favicon = favicon;
  if (image) meta.image = image;
  return meta;
}

/** Fallback card when a page cannot be read or has no title: just the address. */
export function bareCard(url: string): PageMeta {
  return { url, title: hostOf(url) || url, host: hostOf(url) };
}
