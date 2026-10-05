// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.
import type { PageMeta } from './meta.ts';
import { isWebUrl } from './meta.ts';

/** What a `cardlink` block says, cleaned. `image` and `favicon` are an http(s) address or a `[[wikilink]]`. */
export interface CardData {
  url: string;
  title: string;
  description?: string;
  host?: string;
  favicon?: string;
  image?: string;
  /** Leading spaces of the block's lines: how deep in a list it sits. */
  indent: number;
}

export type CardResult = { ok: true; card: CardData } | { ok: false; error: string };

const LOCAL_RE = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/;

/** The note name inside `[[name]]`, or null when the value is not a wikilink. */
export function wikilinkTarget(value: string): string | null {
  return LOCAL_RE.exec(value.trim())?.[1].trim() ?? null;
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * The same `key: value` lines as Auto Card Link's blocks, read leniently:
 * a value may be quoted or bare, and an unquoted `[[wikilink]]` is fine.
 * Used when the YAML parser rejects the block.
 */
export function parseFlat(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
      const q = v[0];
      v = v.slice(1, -1);
      v = q === '"' ? v.replace(/\\(["\\])/g, '$1').replace(/\\n/g, ' ') : v.replace(/''/g, "'");
    }
    out[m[1].toLowerCase()] = v;
  }
  return out;
}

/** Spaces in front of the first non-empty line, with tabs counted as one space as Auto Card Link does. */
export function blockIndent(source: string): number {
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    return /^[ \t]*/.exec(line)?.[0].length ?? 0;
  }
  return 0;
}

/** Validates what the block parsed to. Needs a web `url` and a `title`. */
export function toCard(data: unknown, indent = 0): CardResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'a cardlink block holds lines like "url: https://example.com".' };
  const d = data as Record<string, unknown>;
  const url = text(d.url);
  const title = text(d.title);
  if (!url || !title) return { ok: false, error: 'the block needs "url" and "title".' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'the url must start with http:// or https://.' };
  const card: CardData = { url, title, indent };
  const description = text(d.description);
  const host = text(d.host);
  const favicon = text(d.favicon);
  const image = text(d.image);
  if (description) card.description = description;
  if (host) card.host = host;
  if (favicon) card.favicon = favicon;
  if (image) card.image = image;
  return { ok: true, card };
}

/** True for an image value that may be loaded: a public web address or a wikilink to a vault file. */
export function imageAllowed(value: string): boolean {
  return wikilinkTarget(value) !== null || isWebUrl(value);
}

function yamlString(s: string): string {
  // A JSON string is a valid YAML double-quoted scalar.
  return JSON.stringify(s.replace(/\s+/g, ' ').trim());
}

/** The fenced block, in the layout Auto Card Link writes, so both plugins read it. */
export function cardBlock(meta: PageMeta, indent = ''): string {
  const lines = ['```cardlink', `url: ${yamlString(meta.url)}`, `title: ${yamlString(meta.title)}`];
  if (meta.description) lines.push(`description: ${yamlString(meta.description)}`);
  if (meta.host) lines.push(`host: ${meta.host}`);
  if (meta.favicon) lines.push(`favicon: ${yamlString(meta.favicon)}`);
  if (meta.image) lines.push(`image: ${yamlString(meta.image)}`);
  lines.push('```');
  return lines.map((l) => indent + l).join('\n');
}

export interface UrlTarget {
  /** Start and end of the text to replace, as columns in the line. */
  from: number;
  to: number;
  url: string;
  /** Text before `from` that is only an indent or a list marker, so the card can take its place on the line. */
  prefix: string;
  /** True when nothing else is on the line: the card replaces the whole line. */
  alone: boolean;
  /** Link text, when the target is `[text](url)`. */
  label?: string;
}

const LIST_PREFIX = /^(\s*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?)?)/;

/** The address to turn into a card on `line`: the selected one, the one under `ch`, or the only one on the line. */
export function findUrlTarget(line: string, ch: number, selected?: { from: number; to: number }): UrlTarget | null {
  const candidates: { from: number; to: number; url: string; label?: string }[] = [];
  const link = /\[([^\]]*)\]\((<?)(https?:\/\/[^\s)>]+)>?\)/gi;
  for (let m = link.exec(line); m; m = link.exec(line)) {
    candidates.push({ from: m.index, to: m.index + m[0].length, url: m[3], label: m[1].trim() || undefined });
  }
  const bare = /https?:\/\/[^\s<>)\]]+/gi;
  for (let m = bare.exec(line); m; m = bare.exec(line)) {
    if (candidates.some((c) => m.index >= c.from && m.index < c.to)) continue;
    if (line[m.index - 1] === '<') continue;
    const url = m[0].replace(/[.,;:!?'"]+$/, '');
    candidates.push({ from: m.index, to: m.index + url.length, url });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.from - b.from);
  let pick = candidates.find((c) => (selected ? selected.from < c.to && selected.to > c.from : ch >= c.from && ch <= c.to));
  if (!pick && candidates.length === 1) pick = candidates[0];
  if (!pick) return null;
  const before = line.slice(0, pick.from);
  const prefix = LIST_PREFIX.exec(before)?.[1] ?? '';
  const onlyPrefix = before === prefix;
  const alone = onlyPrefix && line.slice(pick.to).trim() === '';
  return { ...pick, prefix: onlyPrefix ? prefix : '', alone };
}

/** The line range `[start, end]` of the `cardlink` block that holds `line`, or null. Fences must be balanced above it. */
export function findCardBlock(lines: string[], line: number): { start: number; end: number } | null {
  let open = -1;
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (open === -1) {
      open = i;
      fence = m[1];
      if (!/^\s*cardlink\s*$/i.test(m[2])) {
        // Some other code block: skip to its end.
        const close = lines.findIndex((l, j) => j > i && new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`).test(l));
        if (close === -1) return null;
        if (line >= i && line <= close) return null;
        i = close;
        open = -1;
      }
    } else if (m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === '') {
      if (line >= open && line <= i) return { start: open, end: i };
      open = -1;
    }
  }
  return null;
}
