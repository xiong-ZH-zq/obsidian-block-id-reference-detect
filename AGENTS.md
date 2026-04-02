# Obsidian Block ID Reference Detect - Project Agent

## Project Info

- **Plugin name**: Remove Unused Block IDs
- **Plugin ID**: `remove-unused-block-ids`
- **Description**: Scans vault for unused block IDs (^blockID) and removes them
- **Main file**: `main.ts` (271 lines)
- **Min App Version**: 0.15.0
- **Language**: TypeScript

## Key Features

- Scans all markdown files for block IDs (`^blockID` pattern at end of line)
- Detects block ID references via `[[file#^blockID]]` syntax with optional pipe text
- Shows confirmation modal listing unused block IDs before deletion
- Supports excluded file extensions setting (e.g., `.excalidraw.md`)
- Click on block ID in modal to open file at that location

## Project Structure

```
├── main.ts              # Main plugin code (UnusedBlockIdRemover class)
├── manifest.json        # Plugin manifest
├── package.json         # NPM config (devDependencies only)
├── esbuild.config.mjs   # Build config
├── tsconfig.json        # TypeScript config
├── README.md            # User documentation
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
