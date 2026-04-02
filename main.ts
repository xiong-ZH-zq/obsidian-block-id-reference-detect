import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';
import { ViewPlugin, Decoration, EditorView, DecorationSet } from '@codemirror/view';

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

interface UnusedBlockIdRemoverSettings {
    excludedExtensions: string[];
}

const DEFAULT_SETTINGS: Partial<UnusedBlockIdRemoverSettings> = {
    excludedExtensions: ['.excalidraw.md']
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

    async onload() {
        await this.loadSettings();

        const styleEl = document.createElement('style');
        styleEl.id = 'block-id-ref-styles';
        styleEl.textContent = `
            .block-id-ref-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 18px;
                height: 18px;
                padding: 0 4px;
                margin-left: 4px;
                font-size: 12px;
                font-weight: 500;
                color: var(--text-muted);
                background-color: var(--background-secondary);
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            .block-id-ref-count:hover {
                background-color: var(--background-modifier-hover);
            }
        `;
        document.head.appendChild(styleEl);
        this.register(() => styleEl.remove());

        this.addSettingTab(new UnusedBlockIdRemoverSettingTab(this.app, this));

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: () => this.findUnusedBlockIds(),
        });

        this.registerBlockIdExtension();
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

    async findUnusedBlockIds() {
        const loadingNotice = new Notice('Searching for unused block IDs...', 0);

        try {
            const excludedExtensions = this.settings.excludedExtensions.filter(ext => ext);
            const files = this.app.vault.getMarkdownFiles().filter(file => {
                return excludedExtensions.length === 0 || !excludedExtensions.some(ext => file.path.endsWith(ext));
            });

            const blockIds = new Map<string, BlockIdInfo[]>();
            const blockIdReferences = new Map<string, BlockIdReference>();

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

                for (let i = 1; i <= doc.lines; i++) {
                    const line = doc.line(i);
                    const lineText = line.text;

                    blockIdRegex.lastIndex = 0;
                    const match = blockIdRegex.exec(lineText);

                    if (match && plugin.isValidBlockId(match[1])) {
                        const blockId = match[1];
                        const refInfo = plugin.getBlockIdReference(filePath, blockId);
                        const isCursorOnLine = line.from <= cursorPos && cursorPos <= line.to;

                        if (refInfo && refInfo.count > 0 && !isCursorOnLine) {
                            const from = line.to - match[0].length;

                            decorations.push(
                                Decoration.mark({
                                    class: 'block-id-ref-count',
                                    attributes: {
                                        'data-block-id': blockId,
                                        'data-count': String(refInfo.count),
                                        'data-files': refInfo.referencingFiles.join(',')
                                    }
                                }).range(from)
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
