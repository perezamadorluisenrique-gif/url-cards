// Pure logic for keeping card images in the vault: no `obsidian` import, so tests/ can run it under plain Node.
import { unquoteValue, wikilinkTarget, yamlString } from './card.ts';
import { hostOf, isWebUrl } from './meta.ts';

/** Largest image saved, in bytes. A bigger one stays a web address. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/ico': 'ico',
};

/** Every extension a saved image can have, to look for a file saved earlier. */
export const IMAGE_EXTENSIONS: string[] = [...new Set(Object.values(EXTENSIONS))];

/** The file extension for a `Content-Type` header, or null when it is not an image type we keep. */
export function imageExtension(contentType: string | undefined | null): string | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? null;
}

/** A short, stable, lowercase hash of `text`: eight base-36 characters (cyrb53). Not a security hash; it only tells addresses apart. */
export function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(8, '0').slice(-8);
}

/** The file name without its extension: the site's domain and a short hash of the whole address, like `example-com-1a2b3c4d`. */
export function imageBaseName(url: string): string {
  const host = hostOf(url)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${host || 'image'}-${shortHash(url)}`;
}

/** True when an `image` or `favicon` value points into the vault. */
export function isLocalImage(value: string): boolean {
  return wikilinkTarget(value) !== null;
}

/** True when an `image` or `favicon` value is a public web address, so it could be saved. */
export function isRemoteImage(value: string): boolean {
  return !isLocalImage(value) && isWebUrl(value);
}

/** The wikilink for a saved file, `[[folder/name.png]]`, or null when the path holds characters a wikilink cannot carry. */
export function localImageLink(path: string): string | null {
  if (!path || /[[\]|#^\\]/.test(path) || /[\r\n]/.test(path)) return null;
  return `[[${path}]]`;
}

/** Where an image field sits in a note, and the address it holds. */
export interface ImageField {
  /** Line number in the note. */
  line: number;
  key: 'image' | 'favicon';
  /** The indent before the key. */
  prefix: string;
  /** The address, unquoted. */
  url: string;
}

const FIELD_RE = /^(\s*)(image|favicon)[ \t]*:[ \t]*(.*?)\s*$/i;

/** The `image:` and `favicon:` lines of the block between lines `start` and `end` that hold a web address. Local files are left alone. */
export function remoteImageFields(lines: string[], block: { start: number; end: number }): ImageField[] {
  const out: ImageField[] = [];
  for (let i = block.start + 1; i < block.end; i++) {
    const m = FIELD_RE.exec(lines[i]);
    if (!m) continue;
    const url = unquoteValue(m[3]);
    if (isRemoteImage(url)) out.push({ line: i, key: m[2].toLowerCase() as 'image' | 'favicon', prefix: m[1], url });
  }
  return out;
}

/** The line rewrites that swap each field's address for its saved file (`saved` maps an address to a wikilink). Fields without an entry stay as they are. */
export function rewriteImageFields(fields: ImageField[], saved: ReadonlyMap<string, string>): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const f of fields) {
    const link = saved.get(f.url);
    if (link) out.push({ line: f.line, text: `${f.prefix}${f.key}: ${yamlString(link)}` });
  }
  return out;
}
