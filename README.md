# Remove Unused Block IDs

A plugin that removes unused block IDs and displays block reference counts with a Logseq-like experience.

## Features

### Current Features
- **Scan & Remove Unused Block IDs**: Scans all markdown files for unused block IDs (`^blockID`) and removes them after confirmation.
- **Reference Detection**: Detects block ID references via `[[file#^blockID]]` syntax with optional pipe text.

### TODO - New Features (Logseq-like Block Reference Display)

The following features are planned to be implemented to provide a Logseq-like experience:

1. **Block Reference Count Display**
   - Hide the actual block ID name from display
   - Show a badge/box with the count of references (e.g., `[2]` for 2 references)
   - Display format: A small box containing the reference count number

2. **Hover with Ctrl to Show References**
   - When user hovers over the block ID and holds `Ctrl`, show a tooltip/popover
   - The tooltip displays a list of note names that reference this block
   - List format: Show each referencing note's filename or display text

3. **Cursor Line Behavior**
   - When cursor is NOT on the line: Show the reference count badge `[N]`
   - When cursor IS on the line: Show the original block ID name `^blockID`

4. **Styling**
   - Reference count should be styled as a subtle, inline badge
   - Clean, minimal design that doesn't distract from content
   - Hover tooltip should be non-intrusive and informative

## Caution
Consider backing up your vault before using this plugin to avoid any risk of data loss.

## Limitations
- When a block ID is only referenced in a canvas card (and nowhere else), it will be considered unused and added to the unused block IDs list. This happens because a canvas card is not treated like a markdown file.
- If a page has duplicate block IDs and one of those IDs is referenced (as shown in the picture), the plugin won't be able to tell which block is in use. Obsidian also struggles with handling duplicate block IDs within a single page, so avoid using them. If the duplicate IDs aren't referenced, the plugin will work correctly and remove all of the instances of the duplicates.
![Duplicate block ids](https://i.imgur.com/YVLT6zO.png)

## How to use?
1. Open the command palette and run the command **Remove Unused Block IDs: Scan vault**.
2. Confirm the deletion of unused block IDs.

## Author
- xzqbear (https://www.xzqbear.com)
