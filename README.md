# Block Reference Detect

An Obsidian plugin that detects block ID references and displays reference counts with a Logseq-like experience.

## Features

### Reference Count Display
- Block IDs (`^blockID`) show a badge `[↩ N]` when they have N references
- When cursor is on the line: shows the original block ID
- When cursor is off the line: shows the reference count badge

### Real-time Updates
- Reference counts update automatically when files are modified or deleted
- Configurable debounce delay (default 50ms, set to 0 for instant updates)

### Scan & Remove Unused Block IDs
- Scan all markdown files for unused block IDs
- Remove unused block IDs after confirmation
- Supports excluded file extensions setting

### Reference Detection
- Detects block ID references via wikilink: `[[file#^blockID]]`
- Detects block ID references via markdown link: `[text](file#^blockID)`

## Caution
Consider backing up your vault before using this plugin to avoid any risk of data loss.

## Limitations
- When a block ID is only referenced in a canvas card (and nowhere else), it will be considered unused and added to the unused block IDs list. This happens because a canvas card is not treated like a markdown file.
- If a page has duplicate block IDs and one of those IDs is referenced (as shown in the picture), the plugin won't be able to tell which block is in use. Obsidian also struggles with handling duplicate block IDs within a single page, so avoid using them. If the duplicate IDs aren't referenced, the plugin will work correctly and remove all of the instances of the duplicates.
![Duplicate block ids](https://i.imgur.com/YVLT6zO.png)

## How to use?
1. Open the command palette and run the command **Block Reference Detect: Scan vault**.
2. Confirm the deletion of unused block IDs if needed.
3. Configure debounce delay in settings if needed.

## Settings
- **Excluded file extensions**: Files with these extensions will be excluded from scanning (e.g., `.excalidraw.md`)
- **Real-time update debounce**: Delay in milliseconds before updating reference counts after file changes (0 for instant)

## Author
- xzqbear (https://www.xzqbear.com)