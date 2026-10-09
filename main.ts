import { Notice, Plugin, PluginSettingTab, Setting, getLinkpath, normalizePath, parseYaml, requestUrl, setIcon } from 'obsidian';
import type { App, Editor, EditorChange, MarkdownFileInfo, SettingDefinitionItem } from 'obsidian';

import { blockIndent, cardBlock, cardEdit, findCardBlock, findCardBlocks, findUrlTarget, imageAllowed, parseFlat, toCard, wikilinkTarget } from './src/card.ts';
import type { CardData, UrlTarget } from './src/card.ts';
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, imageBaseName, imageExtension, localImageLink, remoteImageFields, rewriteImageFields } from './src/images.ts';
import { asBareUrl, bareCard, extractCard, isWebUrl } from './src/meta.ts';
import type { PageMeta } from './src/meta.ts';

interface UrlCardsSettings {
  /** A lone address pasted on an empty line becomes a card. The commands work either way. */
  cardOnPaste: boolean;
  /** Load the thumbnail and the site icon from the card's own addresses. Off keeps every request to the site you saved. */
  loadImages: boolean;
  /** Making or refreshing a card downloads its image and site icon into the vault and points the card at the files, so it works offline. */
  saveImages: boolean;
  /** Folder for those files. Empty uses the vault's attachment folder setting. */
  imageFolder: string;
  /** The "another plugin draws cardlink blocks" notice was shown and the clash has not cleared since. */
  conflictNoticeShown: boolean;
}

const DEFAULT_SETTINGS: UrlCardsSettings = {
  cardOnPaste: false,
  loadImages: true,
  saveImages: false,
  imageFolder: '',
  conflictNoticeShown: false,
};

const TIMEOUT_MS = 10_000;

export default class UrlCardsPlugin extends Plugin {
  settings: UrlCardsSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    const data = (await this.loadData()) as Partial<UrlCardsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };

    await this.registerCardBlock();

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

    this.addCommand({
      id: 'save-card-images',
      name: 'Save the images of every card in this note',
      icon: 'image-down',
      editorCallback: (editor, ctx) => void this.saveImagesInNote(editor, ctx),
    });

    this.addSettingTab(new UrlCardsSettingTab(this.app, this));
  }

  /**
   * Draws `cardlink` blocks. Obsidian allows one processor per language, so with
   * Auto Card Link on this throws; the commands then still work and the user is
   * told once. Returns whether the blocks are ours.
   */
  async registerCardBlock(): Promise<boolean> {
    try {
      this.registerMarkdownCodeBlockProcessor('cardlink', (source, el) => this.renderCard(source, el));
    } catch {
      if (!this.settings.conflictNoticeShown) {
        new Notice(
          'URL Cards: another plugin, probably Auto Card Link, already draws cardlink blocks, so it keeps drawing them. Turn it off and restart URL Cards to have URL Cards draw them. The commands still work.',
          15_000,
        );
        this.settings.conflictNoticeShown = true;
        await this.saveSettings();
      }
      return false;
    }
    if (this.settings.conflictNoticeShown) {
      this.settings.conflictNoticeShown = false;
      await this.saveSettings();
    }
    return true;
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
  async fetchCard(url: string, showProgress = false): Promise<PageMeta | null> {
    if (!isWebUrl(url)) return null;
    const progress = showProgress ? new Notice('Loading page…', 0) : null;
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
    } finally {
      progress?.hide();
    }
  }

  /** The image at `url` with its file extension, or null when it is missing, not an image, empty or over 5 MB. */
  async fetchImage(url: string): Promise<{ data: ArrayBuffer; ext: string } | null> {
    if (!isWebUrl(url)) return null;
    try {
      const request = requestUrl({ url, throw: false, headers: { Accept: 'image/*' } });
      let timer = 0;
      const timeout = new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), TIMEOUT_MS * 2);
      });
      const res = await Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
      if (!res || res.status >= 400) return null;
      const type = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1];
      const ext = imageExtension(type);
      if (!ext) return null;
      const data = res.arrayBuffer;
      if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) return null;
      return { data, ext };
    } catch {
      return null;
    }
  }

  // ---- images in the vault ----

  /** The folder that holds saved images for a card in the note at `sourcePath`: the setting, else wherever Obsidian puts attachments for that note. */
  private async imageFolder(sourcePath: string): Promise<string> {
    const custom = normalizePath(this.settings.imageFolder.trim()).replace(/^\/+|\/+$/g, '');
    if (custom && custom !== '/' && !custom.split('/').includes('..')) return custom;
    const probe = await this.app.fileManager.getAvailablePathForAttachment('url-cards-image.png', sourcePath);
    const cut = probe.lastIndexOf('/');
    return cut === -1 ? '' : probe.slice(0, cut);
  }

  /**
   * Saves the image at `url` into the vault, or finds the copy saved earlier, and
   * returns the block value that points at it (`[[folder/name.png]]`). Null when
   * it cannot be saved; the card then keeps the web address.
   */
  async saveImage(url: string, sourcePath: string): Promise<string | null> {
    try {
      const folder = await this.imageFolder(sourcePath);
      const base = imageBaseName(url);
      const at = (ext: string) => normalizePath(folder ? `${folder}/${base}.${ext}` : `${base}.${ext}`);
      for (const ext of IMAGE_EXTENSIONS) {
        const file = this.app.vault.getFileByPath(at(ext));
        if (file) return localImageLink(file.path);
      }
      const image = await this.fetchImage(url);
      if (!image) return null;
      const path = at(image.ext);
      // Check the wikilink can hold the path before writing anything.
      if (!localImageLink(path)) return null;
      if (folder && !this.app.vault.getFolderByPath(folder)) {
        try {
          await this.app.vault.createFolder(folder);
        } catch {
          if (!this.app.vault.getFolderByPath(folder)) return null;
        }
      }
      try {
        await this.app.vault.createBinary(path, image.data);
      } catch {
        // Another card saved the same file a moment ago.
        if (!this.app.vault.getFileByPath(path)) return null;
      }
      return localImageLink(path);
    } catch {
      return null;
    }
  }

  /** With "Save card images in the vault" on, `meta` with its image and icon swapped for vault files where saving worked. */
  private async withSavedImages(meta: PageMeta, sourcePath: string | undefined, showProgress = false): Promise<PageMeta> {
    if (!this.settings.saveImages || !sourcePath || (!meta.image && !meta.favicon)) return meta;
    const progress = showProgress ? new Notice('Saving images…', 0) : null;
    try {
      const out = { ...meta };
      if (meta.image) out.image = (await this.saveImage(meta.image, sourcePath)) ?? meta.image;
      if (meta.favicon) out.favicon = (await this.saveImage(meta.favicon, sourcePath)) ?? meta.favicon;
      return out;
    } finally {
      progress?.hide();
    }
  }

  /** Saves the images of every card in the note and points the cards at the files, in one edit. */
  private async saveImagesInNote(editor: Editor, info: MarkdownFileInfo) {
    const path = info.file?.path;
    if (!path) return;
    const before = editor.getValue().split('\n');
    const urls = new Set<string>();
    for (const block of findCardBlocks(before)) for (const f of remoteImageFields(before, block)) urls.add(f.url);
    if (!urls.size) {
      new Notice('No card in this note has an image to save.');
      return;
    }
    const progress = new Notice('Saving images…', 0);
    const saved = new Map<string, string>();
    try {
      for (const url of urls) {
        const value = await this.saveImage(url, path);
        if (value) saved.set(url, value);
      }
    } finally {
      progress.hide();
    }
    if (info.file?.path !== path) return;
    // The note may have changed while the images loaded: find the fields again in its current text.
    const now = editor.getValue().split('\n');
    const changes: EditorChange[] = [];
    for (const block of findCardBlocks(now)) {
      for (const edit of rewriteImageFields(remoteImageFields(now, block), saved)) {
        changes.push({ from: { line: edit.line, ch: 0 }, to: { line: edit.line, ch: now[edit.line].length }, text: edit.text });
      }
    }
    if (changes.length) editor.transaction({ changes });
    const failed = urls.size - saved.size;
    const done = saved.size === 1 ? '1 image saved' : `${saved.size} images saved`;
    new Notice(failed ? `${done}. ${failed} could not be saved and stay web addresses.` : `${done}.`);
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
    const fetched = await this.fetchCard(target.url, true);
    if (!fetched || info.file?.path !== path) return;
    const meta = await this.withSavedImages(fetched, path, true);
    if (info.file?.path !== path) return;
    if (meta.title === meta.host && !meta.description) new Notice('The page gave no details; the card shows only its address.');
    // The line may have changed while the page loaded: only edit if the same address is still there.
    const now = findUrlTarget(editor.getLine(cursor.line), target.from);
    if (!now || now.url !== target.url) return;
    this.writeCard(editor, cursor.line, now, meta);
  }

  /** Puts the card where `target` is: replacing the whole line when it stands alone, else splitting the line around it. */
  private writeCard(editor: Editor, lineNo: number, target: UrlTarget, meta: PageMeta) {
    const line = editor.getLine(lineNo);
    const edit = cardEdit(line, target, meta);
    editor.transaction({ changes: [{ from: { line: lineNo, ch: edit.from }, to: { line: lineNo, ch: line.length }, text: edit.text }] });
  }

  /** After a paste put the bare address on its line, swap it for a card if it is still alone there. */
  private async cardForLine(editor: Editor, info: MarkdownFileInfo, lineNo: number, url: string) {
    const path = info.file?.path;
    const fetched = await this.fetchCard(url);
    if (!fetched || info.file?.path !== path) return;
    const meta = await this.withSavedImages(fetched, path);
    if (info.file?.path !== path) return;
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
    const fetched = await this.fetchCard(parsed.card.url, true);
    if (!fetched || info.file?.path !== path) return;
    const meta = await this.withSavedImages(fetched, path, true);
    if (info.file?.path !== path) return;
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
  saveImages: {
    name: 'Save card images in the vault',
    desc: "When you make or refresh a card, download its image and site icon into your vault and point the card at those files, so it still looks right offline and no server is contacted when you open the note. Images over 5 MB, or that are not images, stay web addresses. The command 'Save the images of every card in this note' does the same for cards you already have, whatever this setting says.",
  },
  imageFolder: {
    name: 'Folder for saved card images',
    desc: "Leave empty to use the attachment folder set in Obsidian's Files and links.",
  },
  loadImages: {
    name: 'Show images from the web',
    desc: "Cards load their thumbnail and site icon from the addresses saved in the block, which tells those servers you opened the note. Turn this off to show text only; images saved in your vault still load.",
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
      { ...TEXT.saveImages, control: { type: 'toggle', key: 'saveImages', defaultValue: DEFAULT_SETTINGS.saveImages } },
      { ...TEXT.imageFolder, control: { type: 'folder', key: 'imageFolder', defaultValue: DEFAULT_SETTINGS.imageFolder, placeholder: 'Attachment folder' } },
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

    new Setting(containerEl)
      .setName(TEXT.saveImages.name)
      .setDesc(TEXT.saveImages.desc)
      .addToggle((t) => t.setValue(this.plugin.settings.saveImages).onChange((v) => this.setControlValue('saveImages', v)));

    new Setting(containerEl)
      .setName(TEXT.imageFolder.name)
      .setDesc(TEXT.imageFolder.desc)
      .addText((t) =>
        t
          .setPlaceholder('Attachment folder')
          .setValue(this.plugin.settings.imageFolder)
          .onChange((v) => this.setControlValue('imageFolder', v.trim())),
      );
  }
}
