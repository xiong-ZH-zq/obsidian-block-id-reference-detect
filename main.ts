import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab, Editor, EditorPosition } from 'obsidian';
import { ViewPlugin, Decoration, EditorView, WidgetType } from '@codemirror/view';

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

const BLOCK_ID_CSS = `
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
.block-id-tooltip {
    position: fixed;
    padding: 8px 12px;
    background-color: var(--background-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 13px;
    max-width: 300px;
    z-index: 1000;
}
.block-id-tooltip-title {
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--text-primary);
}
.block-id-tooltip-list {
    list-style: none;
    padding: 0;
    margin: 0;
}
.block-id-tooltip-list li {
    padding: 2px 0;
    color: var(--text-secondary);
}
`;

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
        styleEl.textContent = BLOCK_ID_CSS;
        document.head.appendChild(styleEl);
        this.register(() => styleEl.remove());

        this.addSettingTab(new UnusedBlockIdRemoverSettingTab(this.app, this));

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: () => this.findUnusedBlockIds(),
        });

        this.registerEditorExtension();
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

            // Map to store block IDs, keyed by file path + block ID
            const blockIds = new Map<string, BlockIdInfo[]>();
            // Map to store block ID reference counts and referencing files
            const blockIdReferences = new Map<string, BlockIdReference>();

            // Collect block IDs and references
            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                this.collectBlockIdsAndReferences(content, file.path, blockIds, blockIdReferences);
            }

            // Identify unused block IDs by comparing blockIds and blockIdReferences
            const unusedBlockIds = Array.from(blockIds.entries())
                .flatMap(([key, blockIdArray]) => {
                    return blockIdArray.filter(item => {
                        const referenceKey = `${item.file}#${item.id}`;
                        return !blockIdReferences.has(referenceKey);
                    });
                });
            
            // Store block ID references for display purposes
            this.blockIdReferences = blockIdReferences;

            loadingNotice.hide();

            // If no unused block IDs found, show notice
            if (unusedBlockIds.length === 0) {
                new Notice('No unused block IDs found.');
            } else {
                // If unused block IDs are found, show the confirmation modal
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
        const blockIdRegex = /(?:\s|^)\^([\w-]+)$/;  // Matches block IDs like ^blockID
        const blockIdRefRegex = /\[\[(.*?)#\^([\w-]+)\s*(\|.*?)?\]\]/g;  // Updated to handle spaces around |

        lines.forEach((line, index) => {
            // Match block IDs at the end of the line, e.g., ^blockID
            const match = line.match(blockIdRegex);
            if (match && this.isValidBlockId(match[1])) {
                const blockId = match[1];
                const blockIdKey = `${filePath}#${blockId}`;  // Create a unique key for block ID + file

                // Check if the blockId already exists in the map, and if so, append to the array
                if (!blockIds.has(blockIdKey)) {
                    blockIds.set(blockIdKey, []);  // Initialize an empty array for the blockId if not already present
                }

                // Push the new occurrence of this block ID to the array
                blockIds.get(blockIdKey)?.push({
                    id: blockId,
                    file: filePath,
                    line: line.trim(),
                    lineNumber: index
                });
            }

            // Match block references, e.g., [[filename#^blockID | optional text]]
            let refMatch;
            while ((refMatch = blockIdRefRegex.exec(line)) !== null) {
                const refFilePath = this.app.metadataCache.getFirstLinkpathDest(refMatch[1], filePath)?.path;  // Resolve the full path for the referenced file
                if (refFilePath) {
                    const blockRefKey = `${refFilePath}#${refMatch[2]}`;  // Create a unique key for the reference
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
            }
        });
    }

    isValidBlockId(id: string): boolean {
        return /^[\w-]+$/.test(id);
    }

    async deleteUnusedBlockIds(unusedBlockIds: UnusedBlockId[]) {
        const loadingNotice = new Notice('Deleting unused block IDs...', 0);
        let totalRemoved = 0;

        // Group block IDs by file for efficient processing
        const blockIdsByFile = unusedBlockIds.reduce((acc, item) => {
            if (!acc[item.file]) {
                acc[item.file] = [];
            }
            acc[item.file].push(item);
            return acc;
        }, {} as Record<string, UnusedBlockId[]>);

        try {
            // Process each file one at a time
            for (const [filePath, blockIds] of Object.entries(blockIdsByFile)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    // Use async processing with a single read and write per file
                    await this.app.vault.process(file, (content) => {
                        const lines = content.split('\n');
                        let fileChanged = false;

                        // Iterate over block IDs for this file
                        blockIds.forEach(blockId => {
                            const lineIndex = blockId.lineNumber;
                            if (lineIndex >= 0 && lineIndex < lines.length) {
                                const blockIdRegex = new RegExp(`\\s*\\^${blockId.id}$`);  // Target only block ID at end of line
                                if (blockIdRegex.test(lines[lineIndex])) {
                                    lines[lineIndex] = lines[lineIndex].replace(blockIdRegex, '');  // Remove the block ID
                                    totalRemoved++;
                                    fileChanged = true;
                                }
                            }
                        });

                        return fileChanged ? lines.join('\n') : content;  // Only save if the file was changed
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

    registerEditorExtension(): void {
        // @ts-ignore - registerEditorExtension accepts Extension but types may be outdated
        this.registerEditorExtension(createBlockIdExtension(this));
    }
}

function createBlockIdExtension(plugin: UnusedBlockIdRemover) {
    const blockIdRegex = /(?:\s|^)\^([\w-]+)$/g;
    
    return ViewPlugin.fromClass(class {
        decorations: any;
        view: EditorView;
        
        constructor(view: EditorView) {
            this.view = view;
            this.decorations = this.buildDecorations();
        }
        
        update() {
            this.decorations = this.buildDecorations();
        }
        
        buildDecorations() {
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
                
                if (match) {
                    const blockId = match[1];
                    const refInfo = plugin.getBlockIdReference(filePath, blockId);
                    const isCursorOnLine = line.from <= cursorPos && cursorPos <= line.to;
                    
                    if (refInfo && refInfo.count > 0 && !isCursorOnLine) {
                        const widget = new BlockIdCountWidget(
                            blockId,
                            refInfo.count,
                            refInfo.referencingFiles,
                            plugin
                        );
                        decorations.push(Decoration.widget({
                            widget,
                            side: 1
                        }).range(line.to));
                    }
                }
            }
            
            return Decoration.set(decorations);
        }
    }, {
        decorations: v => v.decorations
    });
}

class BlockIdCountWidget extends WidgetType {
    blockId: string;
    count: number;
    referencingFiles: string[];
    plugin: UnusedBlockIdRemover;
    
    constructor(blockId: string, count: number, referencingFiles: string[], plugin: UnusedBlockIdRemover) {
        super();
        this.blockId = blockId;
        this.count = count;
        this.referencingFiles = referencingFiles;
        this.plugin = plugin;
    }
    
    toDOM(): HTMLElement {
        const container = document.createElement('span');
        container.className = 'block-id-container has-refs';
        
        const countBox = document.createElement('span');
        countBox.className = 'block-id-ref-count';
        countBox.textContent = String(this.count);
        countBox.setAttribute('data-block-id', this.blockId);
        countBox.setAttribute('data-files', this.referencingFiles.join(','));
        
        countBox.addEventListener('mouseenter', (e) => {
            if (e.ctrlKey) {
                this.showTooltip(e.target as HTMLElement);
            }
        });
        
        countBox.addEventListener('mouseleave', () => {
            this.hideTooltip();
        });
        
        countBox.addEventListener('click', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                this.showTooltip(e.target as HTMLElement);
            }
        });
        
        container.appendChild(countBox);
        return container;
    }
    
    private tooltipEl: HTMLElement | null = null;
    
    showTooltip(target: HTMLElement) {
        this.hideTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.className = 'block-id-tooltip';
        tooltip.innerHTML = `
            <div class="block-id-tooltip-title">References to ^${this.blockId}:</div>
            <ul class="block-id-tooltip-list">
                ${this.referencingFiles.map(f => `<li>${f}</li>`).join('')}
            </ul>
        `;
        
        const rect = target.getBoundingClientRect();
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.top = `${rect.bottom + 4}px`;
        
        document.body.appendChild(tooltip);
        this.tooltipEl = tooltip;
    }
    
    hideTooltip() {
        if (this.tooltipEl) {
            this.tooltipEl.remove();
            this.tooltipEl = null;
        }
    }
    
    eq(other: BlockIdCountWidget): boolean {
        return other.blockId === this.blockId && 
               other.count === this.count &&
               other.referencingFiles.join(',') === this.referencingFiles.join(',');
    }
}
