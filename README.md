# URL Cards

Turn a web address into a card with the page's title, description, image and site icon, in Reading view and Live Preview.

It reads and writes the same `cardlink` code blocks as Auto Card Link, so notes that already use that plugin show their cards untouched.

````markdown
```cardlink
url: https://example.com/article
title: "An article"
description: "What it is about."
host: example.com
image: https://example.com/cover.png
```
````

**Using it with Auto Card Link:** only one plugin can draw `cardlink` blocks at a time. If Auto Card Link is on, it keeps drawing them and URL Cards says so once; its commands still work. Turn Auto Card Link off and restart URL Cards to switch over.

## Network use

**This plugin sends web requests.** When you convert an address (or paste one, if you turn that on), it requests that page from your device with Obsidian's `requestUrl` to read its title, description, image and icon. The site you chose sees that request; nothing is sent anywhere else: no analytics, no third-party service. Only the first 300 KB are read, and only public `http` and `https` addresses are requested. Local and private addresses (`localhost`, `192.168.x.x`, `10.x.x.x`, `.local`) never are.

A card keeps its image and icon as addresses in the block. When a note with cards is shown, Obsidian loads those images from their servers, which tells them you opened the note. Turn off **Show images from the web** to avoid that: cards then show text only, and images from your vault (`image: "[[cover.png]]"`) still load. Images from private addresses or other schemes are never loaded.

## Commands

| Command | What it does |
|---|---|
| Convert URL to card | Turns the address under the cursor, in the selection, or the only one on the line, into a `cardlink` block. A bare address or a `[text](address)` link on its own line becomes the card; in the middle of a sentence the text is split around it; in a list item or task the card sits indented under it, and in a quote or callout every line of the card keeps the `>`. One **Undo** gives the address back. |
| Refresh card | With the cursor inside a `cardlink` block, fetches the page again and rewrites the block. |

If a page cannot be read or has no title, the card shows just the site name. No default hotkeys; assign your own in **Settings → Hotkeys**.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Make a card when pasting an address | Off | A lone address pasted on an empty line (or an empty list item) becomes a card a moment after it lands. Never inside a code block or in the middle of text. |
| Show images from the web | On | Loads each card's thumbnail and site icon from the addresses saved in its block. |

## Writing a card by hand

The block takes `url` and `title` (both required) and optionally `description`, `host`, `favicon` and `image`. `image` and `favicon` can be a web address or a `[[wikilink]]` to a file in your vault. A block without `url` and `title`, or whose `url` is not `http`/`https`, shows an error instead of a card.

## Installation

In Obsidian, open **Settings → Community plugins → Browse** and search for "URL Cards".

## More plugins by Siulved54

| Plugin | What it does | Source |
| --- | --- | --- |
| [Shared Blocks](https://obsidian.md/plugins?id=shared-blocks) | Write a block of text once and reuse it in any note. Edit the source and every reference re-renders live. | [shared-blocks](https://github.com/perezamadorluisenrique-gif/shared-blocks) |
| [Text Case and Cleanup](https://obsidian.md/plugins?id=text-format) | Change case, make camelCase or slugs, sort lines and remove duplicates, and repair text pasted out of a PDF, without touching code or URLs. | [text-format](https://github.com/perezamadorluisenrique-gif/text-format) |
| [Typography as You Type](https://obsidian.md/plugins?id=typography-as-you-type) | Curly quotes, dashes and ellipses as you type, kept out of code and maths, with Backspace to take one back. | [smart-typography-plugin](https://github.com/perezamadorluisenrique-gif/smart-typography-plugin) |
| [Section Numbering](https://obsidian.md/plugins?id=section-numbering) | Number headings as an outline (1, 1.1, 1.2) and keep every link to them working when they renumber. | [section-numbering](https://github.com/perezamadorluisenrique-gif/section-numbering) |
| [Spreadsheet to Table](https://obsidian.md/plugins?id=spreadsheet-to-table) | Paste cells from Excel or Google Sheets as a Markdown table with a real header, insert CSV files, and copy tables back out. | [spreadsheet-to-table](https://github.com/perezamadorluisenrique-gif/spreadsheet-to-table) |
| [Hybrid Line Numbers](https://obsidian.md/plugins?id=hybrid-line-numbers) | Relative and hybrid line numbers for Vim-style jumps, where a folded section counts as one line. | [hybrid-line-numbers](https://github.com/perezamadorluisenrique-gif/hybrid-line-numbers) |
| [List Item Callouts](https://obsidian.md/plugins?id=list-item-callouts) | Colour a single list item as a callout by starting it with a character such as `&`, `!` or `?`. | [list-item-callouts](https://github.com/perezamadorluisenrique-gif/list-item-callouts) |
| [Folder Counts](https://obsidian.md/plugins?id=folder-counts) | See how many notes or files each folder holds, right in the file explorer, with a vault total and folder exclusions. | [folder-counts](https://github.com/perezamadorluisenrique-gif/folder-counts) |
| [Note Reading Time](https://obsidian.md/plugins?id=note-reading-time) | Reading time of the current note or your selection in the status bar, optionally saved to a property. | [note-reading-time](https://github.com/perezamadorluisenrique-gif/note-reading-time) |
| [Task Rollover](https://obsidian.md/plugins?id=task-rollover) | Roll unfinished tasks from your last daily note into today's when it is created, with a real undo. | [task-rollover](https://github.com/perezamadorluisenrique-gif/task-rollover) |
| [Zoom Into Section](https://obsidian.md/plugins?id=zoom-into-section) | Zoom into a heading or list item to see only it and its contents, with a breadcrumb bar to climb back out. | [zoom-into-section](https://github.com/perezamadorluisenrique-gif/zoom-into-section) |
| [Link Title on Paste](https://obsidian.md/plugins?id=link-title-on-paste) | Paste a web address and get a Markdown link with the page's title, fetched in the background and undone in one step. | [link-title-on-paste](https://github.com/perezamadorluisenrique-gif/link-title-on-paste) |
| [Update Radar](https://obsidian.md/plugins?id=update-radar) | Checks your installed community plugins for updates in the background, shows what changed, and flags the ones that look abandoned. | [community-update-checker](https://github.com/perezamadorluisenrique-gif/community-update-checker) |
| [Dataview to Bases](https://obsidian.md/plugins?id=dataview-to-bases) | Convert Dataview queries into Bases blocks, and see which queries in your vault can be converted. | [dataview-to-bases](https://github.com/perezamadorluisenrique-gif/dataview-to-bases) |
| [Line Editing Commands](https://obsidian.md/plugins?id=line-editing-commands) | Duplicate, join, sort and reverse lines, insert blank lines and jump to a line number, with multi-cursor support. | [line-editing-commands](https://github.com/perezamadorluisenrique-gif/line-editing-commands) |
| [Note Mover Rules](https://obsidian.md/plugins?id=note-mover-rules) | Move notes into folders by ordered rules on tags, properties, titles and paths, with a preview before any bulk move. | [note-mover-rules](https://github.com/perezamadorluisenrique-gif/note-mover-rules) |
| [Tab History](https://obsidian.md/plugins?id=tab-history) | Keeps each tab's back and forward history across restarts, and adds commands to move, maximize and close tabs. | [tab-history](https://github.com/perezamadorluisenrique-gif/tab-history) |
| [Vim Config](https://obsidian.md/plugins?id=vim-config) | Loads a vimrc-style file from your vault so your key mappings and editor commands are ready when vim mode starts. | [vim-config](https://github.com/perezamadorluisenrique-gif/vim-config) |
| [Task Archive](https://obsidian.md/plugins?id=task-archive) | Moves completed tasks, with their sub-items, into an archive section or note. | [task-archive](https://github.com/perezamadorluisenrique-gif/task-archive) |

All of them are in the community directory: Settings -> Community plugins ->
Browse, then search for the name.
