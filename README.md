# Block Reference Detect

An Obsidian plugin that detects block ID references and displays reference counts with a Logseq-like experience.

![Showcase](./showcase.gif)

> The plugin will automatically scan the number of reference to the corresponding block and generate show block-id as `[↩ N]`.

## Features

### Reference Count Display
- Block IDs (`^blockID`) show a badge `[↩ N]` when they have N references
- When cursor is on the line: shows the original block ID
- When cursor is off the line: shows the reference count badge
- Reference counts are automatically updated when files are opened, modified, or deleted

### Real-time Updates
- Reference counts update automatically when files are modified or deleted
- Automatically refreshes when opening a file
- Configurable debounce delay (default 50ms, set to 0 for instant updates)

### Scan & Remove Unused Block IDs
- Scan all markdown files for unused block IDs
- Preview unused block IDs before deletion with clickable links to navigate to each location
- Remove unused block IDs after confirmation
- Supports excluded file extensions setting

### Reference Detection
- Detects block ID references via wikilink: `[[file#^blockID]]`
- Detects block ID references via markdown link: `[text](file#^blockID)`
- Supports optional link text: `[[file#^blockID|link text]]`

## How to Use

1. Open the command palette and run the command **Block Reference Detect: Scan vault**
2. Review the list of unused block IDs in the confirmation modal
3. Click on any block ID to navigate to its location
4. Confirm the deletion of unused block IDs if needed
5. Configure debounce delay in settings if needed

## Settings

- **Excluded file extensions**: Files with these extensions will be excluded from scanning (e.g., `.excalidraw.md`)
- **Real-time update debounce**: Delay in milliseconds before updating reference counts after file changes (0 for instant)
- **Click badge to open search**: When enabled, clicking on a `[↩ N]` badge opens Obsidian's built-in search with the block ID as the query
- **Ctrl+hover shows references**: When enabled, holding Ctrl and hovering over a `[↩ N]` badge shows a tooltip listing all files that reference this block ID

## Caution

Consider backing up your vault before using this plugin to avoid any risk of data loss.

## Limitations

- When a block ID is only referenced in a canvas card (and nowhere else), it will be considered unused and added to the unused block IDs list. This happens because a canvas card is not treated like a markdown file.
- If a page has duplicate block IDs and one of those IDs is referenced, the plugin won't be able to tell which block is in use. Obsidian also struggles with handling duplicate block IDs within a single page, so avoid using them. If the duplicate IDs aren't referenced, the plugin will work correctly and remove all of the instances of the duplicates.

![Duplicate block ids](https://i.imgur.com/YVLT6zO.png)

## Acknowledgments

Thank you to [isdmg](https://github.com/isdmg) for the inspiration and showcase.

## Author

- xzqbear (https://www.xzqbear.com)
