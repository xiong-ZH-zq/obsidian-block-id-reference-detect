# Obsidian Block ID Reference Detect - Project Agent

## Project Info

- **Plugin name**: Block Reference Detect
- **Plugin ID**: `block-reference-detect`
- **Description**: An Obsidian plugin that detects block ID references and displays reference counts with a Logseq-like experience.
- **Main file**: `main.ts` (~510 lines)
- **Min App Version**: 0.15.0
- **Language**: TypeScript

## Key Features

- Scans all markdown files for block IDs (`^blockID` pattern at end of line)
- Detects block ID references via `[[file#^blockID]]` and `[text](file#^blockID)` syntax
- Shows confirmation modal listing unused block IDs before deletion
- Supports excluded file extensions setting (e.g., `.excalidraw.md`)
- Click on block ID in modal to open file at that location
- Real-time reference count display via CodeMirror decorations

## Project Structure

```
├── main.ts              # Main plugin code (UnusedBlockIdRemover class)
├── manifest.json        # Plugin manifest
├── package.json         # NPM config (devDependencies only)
├── esbuild.config.mjs   # Build config
├── tsconfig.json        # TypeScript config
├── README.md            # User documentation
├── showcase.gif         # Plugin demo animation
└── versions.json        # Version history
```

## Build Commands

- `npm run dev` - Development build with watch mode
- `npm run build` - Production build (runs `tsc -noEmit -skipLibCheck` first)

## Obsidian Plugin Development Standards

### manifest.json Requirements

- Must declare `minAppVersion` or modern Obsidian will reject the plugin
- Required fields: `id`, `name`, `version`, `minAppVersion`, `description`, `isDesktopOnly`
- Optional: `authorUrl`, `fundingUrl`

### Safety and Null Checking

- Never assume `app.internalPlugins` or sub-plugins are fully loaded
- Use safe traversal: `app.internalPlugins?.plugins?.workspaces?.instance?.activeWorkspace || ""`
- Always validate `.match()` results before use (regex match can be null)
- Check `instanceof TFile` before casting from `getAbstractFileByPath`

### Event Registration

- Use `this.registerDomEvent(element, 'click', callback)` for DOM events
- Use `this.registerInterval(setInterval(callback, 1000))` for intervals
- Failure to unregister can cause memory leaks

### Plugin Structure Best Practices

- Inherit from `Plugin` class to access: `addRibbonIcon`, `addStatusBarItem`, `addCommand`, `addSettingTab`, `registerView`, `loadData`, `saveData`
- Use `this.app.workspace.getLeaf()` to open new file panes
- Use `this.app.vault.process(file, callback)` for atomic file modifications

### Resources

- Official sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- Type definitions: https://github.com/obsidianmd/obsidian-api
- Developer docs: https://docs.obsidian.md/Home
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

---

## Planned Features (TODO)

### Feature 1: Clickable Badge Opens Obsidian Search

**Description**: When clicking on a `[↩ N]` badge, open Obsidian's built-in search with the block ID as the query.

**TODO Tasks**:

- [ ] **1.1** Add `badgeClickOpensSearch: boolean` to `UnusedBlockIdRemoverSettings` interface (default: `true`)
- [ ] **1.2** Add setting toggle in `UnusedBlockIdRemoverSettingTab.display()` under a new "Badge Behavior" section
- [ ] **1.3** Create method `openSearchWithBlockId(blockId: string): Promise<void>`
  ```typescript
  async openSearchWithBlockId(blockId: string): Promise<void> {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({
          type: "search",
          state: { query: `^${blockId}` }
      });
      await this.app.workspace.revealLeaf(leaf);
  }
  ```
- [ ] **1.4** Modify `buildDecorations()` in `registerBlockIdExtension()` to add click handler via `domEventHandlers`
- [ ] **1.5** In click handler, check `this.settings.badgeClickOpensSearch` before calling search method
- [ ] **1.6** Add `title` attribute to decoration showing block ID for accessibility tooltip

**References**:
- Search view type: `"search"`
- Query stored in: `state.query`
- Workspace API: `getLeaf(newLeaf?)`, `setViewState(viewState)`, `revealLeaf(leaf)`

---

### Feature 2: Ctrl+Hover Shows Reference List

**Description**: When holding Ctrl and hovering over a `[↩ N]` badge, show a native tooltip listing all files that reference this block ID.

**TODO Tasks**:

- [ ] **2.1** Add `ctrlHoverShowsReferences: boolean` to `UnusedBlockIdRemoverSettings` interface (default: `true`)
- [ ] **2.2** Add setting toggle in `UnusedBlockIdRemoverSettingTab.display()` under "Badge Behavior" section
- [ ] **2.3** Create tooltip content generator method `getReferenceTooltipText(blockId: string): string`
  - Returns formatted string: `"References:\n- file1.md\n- file2.md\n..."`
  - Use data from `this.blockIdReferences.get(`${filePath}#${blockId}`)?.referencingFiles`
- [ ] **2.4** Create hover state tracking interface:
  ```typescript
  interface HoverState {
      blockId: string | null;
      filePath: string | null;
      isCtrlPressed: boolean;
  }
  ```
- [ ] **2.5** Add `hoverState: HoverState` property to the plugin class
- [ ] **2.6** Modify `buildDecorations()` to add `data-block-id` attribute to decorations
- [ ] **2.7** Register keyboard event listener for Ctrl key in `onload()`:
  ```typescript
  this.registerDomEvent(document, 'keydown', (e) => {
      if (e.key === 'Control') this.hoverState.isCtrlPressed = true;
  });
  this.registerDomEvent(document, 'keyup', (e) => {
      if (e.key === 'Control') this.hoverState.isCtrlPressed = false;
  });
  ```
- [ ] **2.8** Register mouse events on editor view for hover detection (mouseenter, mouseleave)
- [ ] **2.9** Implement hover logic: when hovering decoration with Ctrl pressed, show tooltip via `setAttr('title', tooltipText)`
- [ ] **2.10** Ensure tooltip updates when hovering different block IDs

**References**:
- Block Properties plugin (inspiration): https://github.com/Querulantenkind/obsidian-block-properties-plugin
- Native tooltip: Use `element.setAttr('title', text)` on decoration elements
- Reference data: `this.blockIdReferences` Map with key `${filePath}#${blockId}`

---

### Implementation Notes

1. **Feature 1 Implementation**:
   - Use `this.app.workspace.getLeaf(true)` to open in new pane
   - The `type: "search"` opens Obsidian's built-in search
   - Query format: `^${blockId}` to search for block ID references

2. **Feature 2 Implementation**:
   - Use native HTML `title` attribute for simple tooltip (no custom popover)
   - Tooltip text should list all referencing files from `blockIdReferences`
   - Ctrl key state tracked via document-level keyboard events
   - Only show tooltip when both: (a) hovering a block ID badge AND (b) Ctrl is pressed

3. **Testing Considerations**:
   - Test click behavior with and without `badgeClickOpensSearch` setting
   - Test Ctrl+Hover with multiple block IDs in same file
   - Verify tooltip shows correct reference list

4. **Code Location**:
   - Settings: `UnusedBlockIdRemoverSettingTab` class
   - Decorations: `registerBlockIdExtension()` method, `blockIdPlugin` class
   - Click handling: Inside `buildDecorations()` decoration creation
   - Reference data: `this.blockIdReferences` Map
