import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';
import { ViewPlugin, Decoration, EditorView, DecorationSet, WidgetType } from '@codemirror/view';

interface BlockIdInfo {
    id: string;
    file: string;
    line: string;
    lineNumber: number;
}

interface BlockIdReference {
    count: number;
    referencingFiles: string[];
}

interface UnusedBlockId {
    id: string;
    file: string;
    line: string;
    lineNumber: number;
}

interface HoverState {
    blockId: string | null;
    filePath: string | null;
    isCtrlPressed: boolean;
}

interface UnusedBlockIdRemoverSettings {
    excludedExtensions: string[];
    debounceDelay: number;
    badgeClickOpensSearch: boolean;
    ctrlHoverShowsReferences: boolean;
}

const DEFAULT_SETTINGS: Partial<UnusedBlockIdRemoverSettings> = {
    excludedExtensions: ['.excalidraw.md'],
    debounceDelay: 50,
    badgeClickOpensSearch: true,
    ctrlHoverShowsReferences: true
}

class UnusedBlockIdRemoverSettingTab extends PluginSettingTab {
    plugin: UnusedBlockIdRemover;

    constructor(app: App, plugin: UnusedBlockIdRemover) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Excluded file extensions')
            .setDesc('Add file extensions (e.g., .excalidraw.md) separated by commas to exclude from scanning.')
            .addTextArea((text) => {
                text
                    .setPlaceholder('Enter extensions separated by commas')
                    .setValue(this.plugin.settings.excludedExtensions.join(', '))
                    .onChange(async (value) => {
                        this.plugin.settings.excludedExtensions = value.split(',').map(ext => ext.trim());
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Real-time update debounce')
            .setDesc('Delay in milliseconds before updating reference counts after file changes. Set to 0 for instant updates.')
            .addTextArea((text) => {
                text
                    .setPlaceholder('50')
                    .setValue(String(this.plugin.settings.debounceDelay))
                    .onChange(async (value) => {
                        const delay = parseInt(value, 10);
                        if (!isNaN(delay) && delay >= 0) {
                            this.plugin.settings.debounceDelay = delay;
                            await this.plugin.saveSettings();
                        }
                    });
            });

        containerEl.createEl('h3', { text: 'Badge Behavior' });

        new Setting(containerEl)
            .setName('Click badge to open search')
            .setDesc('When clicking on a [↩ N] badge, open Obsidian\'s built-in search with the block ID as the query.')
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.badgeClickOpensSearch)
                    .onChange(async (value) => {
                        this.plugin.settings.badgeClickOpensSearch = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Ctrl+hover shows references')
            .setDesc('When holding Ctrl and hovering over a [↩ N] badge, show a tooltip listing all files that reference this block ID.')
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.ctrlHoverShowsReferences)
                    .onChange(async (value) => {
                        this.plugin.settings.ctrlHoverShowsReferences = value;
                        await this.plugin.saveSettings();
                    });
            });
    }
}

class ConfirmationModal extends Modal {
    plugin: UnusedBlockIdRemover;
    unusedBlockIds: UnusedBlockId[];

    constructor(plugin: UnusedBlockIdRemover, unusedBlockIds: UnusedBlockId[]) {
        super(plugin.app);
        this.plugin = plugin;
        this.unusedBlockIds = unusedBlockIds;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: `Unused Block IDs: (${this.unusedBlockIds.length})` });

        const list = contentEl.createEl('ul');
        this.unusedBlockIds.forEach(item => {
            const li = list.createEl('li');
            const link = li.createEl('a', {
                text: item.id,
                href: '#'
            });
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.plugin.openFileAtBlockId(item.file, item.id, item.lineNumber);
            });
            li.createEl('span', { text: ` in file: ${item.file}` });
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Delete all')
                .onClick(() => {
                    this.plugin.deleteUnusedBlockIds(this.unusedBlockIds);
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export default class UnusedBlockIdRemover extends Plugin {
    settings: UnusedBlockIdRemoverSettings;
    private blockIdReferences: Map<string, BlockIdReference> = new Map();
    private blockIdsByFile: Map<string, Set<string>> = new Map();
    private referenceSources: Map<string, Set<string>> = new Map();
    private modifyDebounceTimer: number | null = null;
    private hoverState: HoverState = {
        blockId: null,
        filePath: null,
        isCtrlPressed: false
    };
    private hoveredBadgeEl: HTMLElement | null = null;
    private hoveredBadgeBlockId: string | null = null;
    private hoveredBadgeFilePath: string | null = null;

    async onload() {
        await this.loadSettings();

        const styleEl = document.createElement('style');
        styleEl.id = 'block-id-ref-styles';
        styleEl.textContent = `
            .cm-blockid-badge {
                font-size: 12px;
                color: #0093ff;
            }
            .cm-blockid-hidden {
                visibility: hidden;
            }
            .cm-activeLine .cm-blockid-hidden {
                visibility: visible;
            }
        `;
        document.head.appendChild(styleEl);
        this.register(() => styleEl.remove());

        this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Control') {
                this.hoverState.isCtrlPressed = true;
                if (this.hoveredBadgeEl && this.hoveredBadgeBlockId && this.hoveredBadgeFilePath && this.settings.ctrlHoverShowsReferences) {
                    const tooltipText = this.getReferenceTooltipText(this.hoveredBadgeFilePath, this.hoveredBadgeBlockId);
                    this.hoveredBadgeEl.setAttribute('title', tooltipText);
                }
            }
        });
        this.registerDomEvent(document, 'keyup', (e: KeyboardEvent) => {
            if (e.key === 'Control') {
                this.hoverState.isCtrlPressed = false;
                if (this.hoveredBadgeEl) {
                    this.hoveredBadgeEl.removeAttribute('title');
                }
            }
        });

        this.addSettingTab(new UnusedBlockIdRemoverSettingTab(this.app, this));

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: () => this.findUnusedBlockIds(),
        });

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.modifyDebounceTimer !== null) {
                        window.clearTimeout(this.modifyDebounceTimer);
                    }
                    const delay = this.settings.debounceDelay;
                    if (delay === 0) {
                        this.app.vault.cachedRead(file).then((content) => {
                            this.updateFileReferences(file, content);
                        });
                    } else {
                        this.modifyDebounceTimer = window.setTimeout(() => {
                            this.modifyDebounceTimer = null;
                            this.app.vault.cachedRead(file).then((content) => {
                                this.updateFileReferences(file, content);
                            });
                        }, delay);
                    }
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile) {
                    this.clearFileReferences(file.path);
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.app.vault.cachedRead(file).then((content) => {
                        this.updateFileReferences(file, content);
                    });
                }
            })
        );

        this.registerBlockIdExtension();

        await this.scanVault();
    }

    onunload() { }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async scanVault(): Promise<UnusedBlockId[]> {
        const excludedExtensions = this.settings.excludedExtensions.filter(ext => ext);
        const files = this.app.vault.getMarkdownFiles().filter(file => {
            return excludedExtensions.length === 0 || !excludedExtensions.some(ext => file.path.endsWith(ext));
        });

        const blockIds = new Map<string, BlockIdInfo[]>();
        const blockIdReferences = new Map<string, BlockIdReference>();

        this.blockIdsByFile.clear();
        this.referenceSources.clear();

        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            this.collectBlockIdsAndReferences(content, file.path, blockIds, blockIdReferences);
        }

        const unusedBlockIds = Array.from(blockIds.entries())
            .flatMap(([key, blockIdArray]) => {
                return blockIdArray.filter(item => {
                    const referenceKey = `${item.file}#${item.id}`;
                    return !blockIdReferences.has(referenceKey);
                });
            });

        this.blockIdReferences = blockIdReferences;

        return unusedBlockIds;
    }

    async findUnusedBlockIds() {
        const loadingNotice = new Notice('Searching for unused block IDs...', 0);

        try {
            const unusedBlockIds = await this.scanVault();
            loadingNotice.hide();

            if (unusedBlockIds.length === 0) {
                new Notice('No unused block IDs found.');
            } else {
                new ConfirmationModal(this, unusedBlockIds).open();
            }
        } catch (error) {
            loadingNotice.hide();
            new Notice(`Error: ${error.message}`);
        }
    }

    collectBlockIdsAndReferences(
        content: string,
        filePath: string,
        blockIds: Map<string, BlockIdInfo[]>,
        blockIdReferences: Map<string, BlockIdReference>
    ) {
        const lines = content.split('\n');
        const blockIdRegex = /(?:\s|^)\^([\w-]+)$/;

        const wikilinkRefRegex = /\[\[(.*?)#\^([\w-]+)(?:\|([^\]]*?))?\]\]/g;
        const markdownRefRegex = /\[([^\]]*?)\]\(([^)#]*?)#\^([\w-]+)(?:\|([^)]*?))?\)/g;

        const processRef = (refBlockId: string, refFile: string) => {
            if (!this.isValidBlockId(refBlockId)) return;
            let resolvedFilePath: string | undefined;

            if (refFile === '' || refFile === undefined) {
                resolvedFilePath = filePath;
            } else {
                resolvedFilePath = this.app.metadataCache.getFirstLinkpathDest(refFile, filePath)?.path;
            }

            if (resolvedFilePath) {
                const blockRefKey = `${resolvedFilePath}#${refBlockId}`;
                const existing = blockIdReferences.get(blockRefKey);
                if (existing) {
                    existing.count++;
                    existing.referencingFiles.push(filePath);
                } else {
                    blockIdReferences.set(blockRefKey, {
                        count: 1,
                        referencingFiles: [filePath]
                    });
                }

                if (!this.referenceSources.has(blockRefKey)) {
                    this.referenceSources.set(blockRefKey, new Set());
                }
                this.referenceSources.get(blockRefKey)!.add(filePath);
            }
        };

        lines.forEach((line, index) => {
            const match = line.match(blockIdRegex);
            if (match && this.isValidBlockId(match[1])) {
                const blockId = match[1];
                const blockIdKey = `${filePath}#${blockId}`;

                if (!blockIds.has(blockIdKey)) {
                    blockIds.set(blockIdKey, []);
                }

                blockIds.get(blockIdKey)?.push({
                    id: blockId,
                    file: filePath,
                    line: line.trim(),
                    lineNumber: index
                });

                if (!this.blockIdsByFile.has(filePath)) {
                    this.blockIdsByFile.set(filePath, new Set());
                }
                this.blockIdsByFile.get(filePath)!.add(blockId);
            }

            let refMatch;

            wikilinkRefRegex.lastIndex = 0;
            while ((refMatch = wikilinkRefRegex.exec(line)) !== null) {
                const refFile = refMatch[1] || '';
                const refBlockId = refMatch[2];
                processRef(refBlockId, refFile);
            }

            markdownRefRegex.lastIndex = 0;
            while ((refMatch = markdownRefRegex.exec(line)) !== null) {
                const refBlockId = refMatch[3];
                const refFile = refMatch[2] || '';
                processRef(refBlockId, refFile);
            }
        });
    }

    clearFileReferences(filePath: string): void {
        const blockIds = this.blockIdsByFile.get(filePath);
        if (blockIds) {
            for (const blockId of blockIds) {
                const key = `${filePath}#${blockId}`;
                this.blockIdReferences.delete(key);
            }
            this.blockIdsByFile.delete(filePath);
        }

        for (const [key, sources] of this.referenceSources.entries()) {
            if (sources.has(filePath)) {
                sources.delete(filePath);
                const refInfo = this.blockIdReferences.get(key);
                if (refInfo) {
                    refInfo.count = sources.size;
                    refInfo.referencingFiles = Array.from(sources);
                }
                if (sources.size === 0) {
                    this.referenceSources.delete(key);
                }
            }
        }
    }

    updateFileReferences(file: TFile, newContent: string): void {
        this.clearFileReferences(file.path);
        this.collectBlockIdsAndReferences(newContent, file.path, new Map(), this.blockIdReferences);
    }

    isValidBlockId(id: string): boolean {
        return /^[\w-]+$/.test(id);
    }

    async deleteUnusedBlockIds(unusedBlockIds: UnusedBlockId[]) {
        const loadingNotice = new Notice('Deleting unused block IDs...', 0);
        let totalRemoved = 0;

        const blockIdsByFile = unusedBlockIds.reduce((acc, item) => {
            if (!acc[item.file]) {
                acc[item.file] = [];
            }
            acc[item.file].push(item);
            return acc;
        }, {} as Record<string, UnusedBlockId[]>);

        try {
            for (const [filePath, blockIds] of Object.entries(blockIdsByFile)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await this.app.vault.process(file, (content) => {
                        const lines = content.split('\n');
                        let fileChanged = false;

                        blockIds.forEach(blockId => {
                            const lineIndex = blockId.lineNumber;
                            if (lineIndex >= 0 && lineIndex < lines.length) {
                                const blockIdRegex = new RegExp(`\\s*\\^${blockId.id}$`);
                                if (blockIdRegex.test(lines[lineIndex])) {
                                    lines[lineIndex] = lines[lineIndex].replace(blockIdRegex, '');
                                    totalRemoved++;
                                    fileChanged = true;
                                }
                            }
                        });

                        return fileChanged ? lines.join('\n') : content;
                    });
                }
            }

            loadingNotice.hide();
            new Notice(`Removed ${totalRemoved} unused block IDs.`);
        } catch (error) {
            loadingNotice.hide();
            new Notice(`Error: ${error.message}`);
        }
    }

    async openFileAtBlockId(filePath: string, blockId: string, lineNumber: number) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(file, {
                eState: { line: lineNumber }
            });
        }
    }

    async openSearchWithBlockId(blockId: string): Promise<void> {
        console.log('[BlockRef] openSearchWithBlockId called with:', blockId);
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.setViewState({
            type: "search",
            state: { query: `^${blockId}` }
        });
        await this.app.workspace.revealLeaf(leaf);
    }

    getReferenceTooltipText(filePath: string, blockId: string): string {
        const key = `${filePath}#${blockId}`;
        const refInfo = this.blockIdReferences.get(key);
        if (!refInfo || refInfo.referencingFiles.length === 0) {
            return 'No references';
        }
        const filesList = refInfo.referencingFiles.map(f => `- ${f}`).join('\n');
        return `References:\n${filesList}`;
    }

    getBlockIdReference(filePath: string, blockId: string): BlockIdReference | undefined {
        const key = `${filePath}#${blockId}`;
        return this.blockIdReferences.get(key);
    }

    getAllBlockIdReferences(): Map<string, BlockIdReference> {
        return this.blockIdReferences;
    }

    registerBlockIdExtension(): void {
        const plugin = this;
        const { ViewPlugin, Decoration, EditorView } = require('@codemirror/view');

        const blockIdRegex = /(?:\s|^)\^([\w-]+)$/g;

        const blockIdPlugin = ViewPlugin.fromClass(class {
            decorations: DecorationSet;
            view: EditorView;

            constructor(view: EditorView) {
                this.view = view;
                this.decorations = this.buildDecorations();
            }

            update() {
                this.decorations = this.buildDecorations();
            }

            buildDecorations(): DecorationSet {
                const decorations: any[] = [];
                const currentFile = plugin.app.workspace.getActiveFile();
                if (!currentFile) return Decoration.none;

                const filePath = currentFile.path;
                const doc = this.view.state.doc;
                const cursorPos = this.view.state.selection.main.head;
                const activeLineNumber = doc.lineAt(cursorPos).number;

                for (let i = 1; i <= doc.lines; i++) {
                    const line = doc.line(i);
                    const lineText = line.text;

                    blockIdRegex.lastIndex = 0;
                    const match = blockIdRegex.exec(lineText);

                    if (match && plugin.isValidBlockId(match[1])) {
                        const blockId = match[1];
                        const refInfo = plugin.getBlockIdReference(filePath, blockId);
                        const isCursorOnLine = i === activeLineNumber;
                        const hasRefs = refInfo && refInfo.count > 0;

                        const blockIdStart = line.to - match[0].length;

                        if (hasRefs && !isCursorOnLine) {
                            console.log('[BlockRef] Creating badge decoration for blockId:', blockId, 'count:', refInfo.count);
                            
                            const badgeEl = document.createElement('span');
                            badgeEl.className = 'cm-blockid-badge';
                            badgeEl.textContent = `[↩ ${refInfo.count}]`;
                            badgeEl.setAttribute('data-block-id', blockId);
                            
                            badgeEl.addEventListener('click', (e) => {
                                console.log('[BlockRef] Badge click fired', {
                                    blockId: blockId,
                                    badgeClickOpensSearch: plugin.settings.badgeClickOpensSearch
                                });
                                e.preventDefault();
                                if (plugin.settings.badgeClickOpensSearch) {
                                    plugin.openSearchWithBlockId(blockId);
                                }
                            });
                            
                            badgeEl.addEventListener('mouseenter', (e) => {
                                console.log('[BlockRef] Badge mouseenter fired', {
                                    blockId: blockId,
                                    ctrlHoverShowsReferences: plugin.settings.ctrlHoverShowsReferences,
                                    isCtrlPressed: plugin.hoverState.isCtrlPressed
                                });
                                plugin.hoveredBadgeEl = e.target as HTMLElement;
                                plugin.hoveredBadgeBlockId = blockId;
                                plugin.hoveredBadgeFilePath = filePath;
                                if (plugin.settings.ctrlHoverShowsReferences && plugin.hoverState.isCtrlPressed) {
                                    const tooltipText = plugin.getReferenceTooltipText(filePath, blockId);
                                    (e.target as HTMLElement).setAttribute('title', tooltipText);
                                }
                            });
                            
                            badgeEl.addEventListener('mouseleave', (e) => {
                                console.log('[BlockRef] Badge mouseleave fired');
                                plugin.hoveredBadgeEl = null;
                                plugin.hoveredBadgeBlockId = null;
                                plugin.hoveredBadgeFilePath = null;
                                (e.target as HTMLElement).removeAttribute('title');
                            });
                            
                            const badgeWidget = new class extends WidgetType {
                                toDOM(): HTMLElement {
                                    return badgeEl;
                                }
                                eq(): boolean {
                                    return false;
                                }
                            };
                            
                            decorations.push(
                                Decoration.widget({
                                    widget: badgeWidget,
                                    side: -1
                                }).range(blockIdStart)
                            );
                            
                            decorations.push(
                                Decoration.mark({
                                    class: 'cm-blockid-hidden'
                                }).range(blockIdStart, line.to)
                            );
                        }
                    }
                }

                return Decoration.set(decorations);
            }
        }, {
            decorations: (v: any) => v.decorations
        });

        // @ts-ignore - registerEditorExtension accepts Extension but types may be outdated
        this.registerEditorExtension(blockIdPlugin);
    }
}
