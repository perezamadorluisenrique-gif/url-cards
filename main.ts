import { Notice, Plugin, PluginSettingTab, Setting, getLinkpath, parseYaml, requestUrl, setIcon } from 'obsidian';
import type { App, Editor, MarkdownFileInfo, SettingDefinitionItem } from 'obsidian';

import { blockIndent, cardBlock, findCardBlock, findUrlTarget, imageAllowed, parseFlat, toCard, wikilinkTarget } from './src/card.ts';
import type { CardData, UrlTarget } from './src/card.ts';
import { asBareUrl, bareCard, extractCard, isWebUrl } from './src/meta.ts';
import type { PageMeta } from './src/meta.ts';

interface UrlCardsSettings {
  /** A lone address pasted on an empty line becomes a card. The commands work either way. */
  cardOnPaste: boolean;
  /** Load the thumbnail and the site icon from the card's own addresses. Off keeps every request to the site you saved. */
  loadImages: boolean;
}

const DEFAULT_SETTINGS: UrlCardsSettings = {
  cardOnPaste: false,
  loadImages: true,
};

const TIMEOUT_MS = 10_000;

export default class UrlCardsPlugin extends Plugin {
  settings: UrlCardsSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    const data = (await this.loadData()) as Partial<UrlCardsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };

    this.registerMarkdownCodeBlockProcessor('cardlink', (source, el) => this.renderCard(source, el));

    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt, editor, info) => {
        if (evt.defaultPrevented || !this.settings.cardOnPaste) return;
        const url = asBareUrl(evt.clipboardData?.getData('text/plain') ?? '');
        if (!url || editor.somethingSelected() || editor.listSelections().length > 1) return;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        // Only on a line of its own, and never inside a code block.
        if (line.trim() !== '' && !/^\s*(?:[-*+]|\d{1,9}[.)])\s+$/.test(line)) return;
        if (insideFence(editor, cursor.line)) return;
        evt.preventDefault();
        editor.replaceSelection(url);
        void this.cardForLine(editor, info, cursor.line, url);
      }),
    );

    this.addCommand({
      id: 'convert-url-to-card',
      name: 'Convert URL to card',
      icon: 'layout-panel-top',
      editorCallback: (editor, ctx) => void this.convertAtCursor(editor, ctx),
    });

    this.addCommand({
      id: 'refresh-card',
      name: 'Refresh card',
      icon: 'refresh-cw',
      editorCheckCallback: (checking, editor, ctx) => {
        const block = findCardBlock(editor.getValue().split('\n'), editor.getCursor().line);
        if (!block) return false;
        if (!checking) void this.refreshCard(editor, ctx, block);
        return true;
      },
    });

    this.addSettingTab(new UrlCardsSettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---- reading cards ----

  private renderCard(source: string, el: HTMLElement) {
    let parsed: unknown;
    try {
      parsed = parseYaml(source);
    } catch {
      parsed = null;
    }
    let result = toCard(parsed, blockIndent(source));
    // YAML refuses some blocks that Auto Card Link's notes contain, such as an unquoted [[image]].
    if (!result.ok) result = toCard(parseFlat(source), blockIndent(source));
    if (!result.ok) {
      el.createDiv({ cls: 'url-cards-error', text: `Card error: ${result.error}` });
      return;
    }
    this.buildCard(el, result.card);
  }

  private buildCard(el: HTMLElement, card: CardData) {
    const wrap = el.createDiv({ cls: 'url-cards-container' });
    wrap.setAttr('data-url-cards-depth', String(card.indent));
    // Cards only link out to the web: a javascript: or file: address in a pasted note stays text.
    const link = wrap.createEl('a', { cls: 'url-cards-card' });
    if (isWebUrl(card.url)) {
      link.setAttr('href', card.url);
      link.setAttr('target', '_blank');
      link.setAttr('rel', 'noopener');
    }
    const main = link.createDiv({ cls: 'url-cards-main' });
    main.createDiv({ cls: 'url-cards-title', text: card.title });
    if (card.description) main.createDiv({ cls: 'url-cards-description', text: card.description });
    const host = main.createDiv({ cls: 'url-cards-host' });
    const favicon = this.imageSource(card.favicon);
    if (favicon) host.createEl('img', { cls: 'url-cards-favicon', attr: { src: favicon, alt: '' } });
    if (card.host) host.createSpan({ text: card.host });
    const image = this.imageSource(card.image);
    if (image) link.createEl('img', { cls: 'url-cards-thumbnail', attr: { src: image, alt: '', draggable: 'false' } });

    const copy = wrap.createEl('button', { cls: 'url-cards-copy clickable-icon', attr: { 'aria-label': 'Copy address' } });
    setIcon(copy, 'copy');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(card.url).then(() => new Notice('Address copied'));
    });
  }

  /** The `src` for a card image: a vault file for `[[name]]`, a public web address when loading is on, else null. */
  private imageSource(value: string | undefined): string | null {
    if (!value || !imageAllowed(value)) return null;
    const local = wikilinkTarget(value);
    if (local) {
      const file = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(local), '');
      return file ? this.app.vault.getResourcePath(file) : null;
    }
    return this.settings.loadImages ? value : null;
  }

  // ---- fetching ----

  /** Card data for `url`: its Open Graph tags, else its title, else just the address. Null when it is not a public page. */
  async fetchCard(url: string): Promise<PageMeta | null> {
    if (!isWebUrl(url)) return null;
    try {
      const request = requestUrl({ url, throw: false, headers: { Accept: 'text/html,application/xhtml+xml' } });
      let timer = 0;
      const timeout = new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), TIMEOUT_MS);
      });
      const res = await Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
      if (!res || res.status >= 400) return bareCard(url);
      const type = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
      if (type && !/html|xml/i.test(type)) return bareCard(url);
      return extractCard(res.text, url) ?? bareCard(url);
    } catch {
      return bareCard(url);
    }
  }

  // ---- writing cards ----

  private async convertAtCursor(editor: Editor, info: MarkdownFileInfo) {
    const cursor = editor.getCursor('from');
    const end = editor.getCursor('to');
    const line = editor.getLine(cursor.line);
    const target = findUrlTarget(line, cursor.ch, end.line === cursor.line && end.ch > cursor.ch ? { from: cursor.ch, to: end.ch } : undefined);
    if (!target) {
      new Notice('No web address on this line.');
      return;
    }
    if (!isWebUrl(target.url)) {
      new Notice('This address is not a public web page.');
      return;
    }
    const path = info.file?.path;
    const meta = await this.fetchCard(target.url);
    if (!meta || info.file?.path !== path) return;
    if (meta.title === meta.host && !meta.description) new Notice('The page gave no details; the card shows only its address.');
    // The line may have changed while the page loaded: only edit if the same address is still there.
    const now = findUrlTarget(editor.getLine(cursor.line), target.from);
    if (!now || now.url !== target.url) return;
    this.writeCard(editor, cursor.line, now, meta);
  }

  /** Puts the card where `target` is: replacing the whole line when it stands alone, else splitting the line around it. */
  private writeCard(editor: Editor, lineNo: number, target: UrlTarget, meta: PageMeta) {
    const line = editor.getLine(lineNo);
    const to = { line: lineNo, ch: line.length };
    if (target.alone) {
      // After a list marker the card goes on the next line, indented under the item.
      const block = cardBlock(meta, ' '.repeat(target.prefix.length));
      editor.transaction({ changes: [{ from: { line: lineNo, ch: target.prefix.length }, to, text: target.prefix ? '\n' + block : block }] });
      return;
    }
    const lead = line.slice(0, target.from).replace(/\s+$/, '');
    const trail = line.slice(target.to).replace(/^\s+/, '');
    const indent = /^\s*/.exec(line)?.[0] ?? '';
    const text = [lead, cardBlock(meta, indent), trail && indent + trail].filter(Boolean).join('\n');
    editor.transaction({ changes: [{ from: { line: lineNo, ch: 0 }, to, text }] });
  }

  /** After a paste put the bare address on its line, swap it for a card if it is still alone there. */
  private async cardForLine(editor: Editor, info: MarkdownFileInfo, lineNo: number, url: string) {
    const path = info.file?.path;
    const meta = await this.fetchCard(url);
    if (!meta || info.file?.path !== path) return;
    const lines = editor.getValue().split('\n');
    const same = (i: number) => {
      const t = lines[i] !== undefined ? findUrlTarget(lines[i], 0) : null;
      return t?.alone && t.url === url ? t : null;
    };
    let at = same(lineNo) ? lineNo : -1;
    if (at === -1) {
      // The user typed above while the page loaded: use the one line that is only this address.
      const hits = lines.map((_, i) => i).filter((i) => same(i));
      if (hits.length === 1) at = hits[0];
    }
    const target = at === -1 ? null : same(at);
    if (target) this.writeCard(editor, at, target, meta);
  }

  private async refreshCard(editor: Editor, info: MarkdownFileInfo, block: { start: number; end: number }) {
    const lines = editor.getValue().split('\n');
    const body = lines.slice(block.start + 1, block.end).join('\n');
    const parsed = toCard(parseFlat(body));
    if (!parsed.ok) {
      new Notice(`Card error: ${parsed.error}`);
      return;
    }
    const path = info.file?.path;
    const meta = await this.fetchCard(parsed.card.url);
    if (!meta || info.file?.path !== path) return;
    const fresh = editor.getValue().split('\n');
    if (fresh.slice(block.start + 1, block.end).join('\n') !== body) return;
    const indent = /^\s*/.exec(lines[block.start])?.[0] ?? '';
    editor.transaction({
      changes: [
        {
          from: { line: block.start, ch: 0 },
          to: { line: block.end, ch: lines[block.end].length },
          text: cardBlock(meta, indent),
        },
      ],
    });
  }
}

/** True when `line` is inside a fenced code block (an open fence above it). */
function insideFence(editor: Editor, line: number): boolean {
  let open = false;
  for (let i = 0; i < line; i++) if (/^\s*(```|~~~)/.test(editor.getLine(i))) open = !open;
  return open;
}

const TEXT = {
  cardOnPaste: {
    name: 'Make a card when pasting an address',
    desc: 'When you paste a lone address on an empty line, the page is requested to read its title, description and image, and the address becomes a card. The address is sent to the site. Turn this off to use only the command.',
  },
  loadImages: {
    name: 'Show images from the web',
    desc: "Cards load their thumbnail and site icon from the addresses saved in the block, which tells those servers you opened the note. Turn this off to show text only; images from your vault still load.",
  },
};

class UrlCardsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: UrlCardsPlugin,
  ) {
    super(app, plugin);
  }

  /** Obsidian 1.13+ renders this itself and indexes it for the settings search; older versions call `display()`. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { ...TEXT.cardOnPaste, control: { type: 'toggle', key: 'cardOnPaste', defaultValue: DEFAULT_SETTINGS.cardOnPaste } },
      { ...TEXT.loadImages, control: { type: 'toggle', key: 'loadImages', defaultValue: DEFAULT_SETTINGS.loadImages } },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    Object.assign(this.plugin.settings, { [key]: value });
    await this.plugin.saveSettings();
  }

  /** The pre-1.13 rendering, from the same text. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(TEXT.cardOnPaste.name)
      .setDesc(TEXT.cardOnPaste.desc)
      .addToggle((t) => t.setValue(this.plugin.settings.cardOnPaste).onChange((v) => this.setControlValue('cardOnPaste', v)));

    new Setting(containerEl)
      .setName(TEXT.loadImages.name)
      .setDesc(TEXT.loadImages.desc)
      .addToggle((t) => t.setValue(this.plugin.settings.loadImages).onChange((v) => this.setControlValue('loadImages', v)));
  }
}
