import {
    App,
    FuzzySuggestModal,
    MarkdownView,
    moment,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile
} from 'obsidian';


interface AutoLinkPluginSettings {
    targetNote: TFile;
    defaultCountry: string;
    anchorHeader: string;
}

// Intentionally kept lowercase to unify variations
const COUNTRIES: Record<string, string> = {
    'germany': '🇩🇪',
    'austria': '🇦🇹',
    'canada': '🇨🇦',
    'ukraine': '🇺🇦',
}

const DEFAULT_SETTINGS: Partial<AutoLinkPluginSettings> = {
    anchorHeader: '# Applied',
    defaultCountry: 'germany'
}

export default class AutoLinkPlugin extends Plugin {
    settings: AutoLinkPluginSettings;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'insert-link-into-target',
            name: `Autolink this note in ${this.settings.targetNote?.basename}`,
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'a' }],
            checkCallback: (checking: boolean) => {
                if (!this.settings.targetNote) {
                    if (!checking) {
                        new Notice('No target note selected');
                    }
                    return false;
                }

                const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!markdownView || !markdownView.file) {
                    if (!checking) {
                        new Notice('No active file');
                    }
                    return false;
                }

                const activeFile = markdownView.file;
                if (!activeFile.parent) {
                    if (!checking) {
                        new Notice('No country folder');
                    }
                    return false;
                }

                let directory = activeFile.parent;
                let displayName: string;
                let country: string;
                // The directory is not a country name. It may be a display name if the grandparent is a country.
                if (COUNTRIES[directory.name.toLowerCase()] === undefined) {
                    let grandparent = activeFile.parent.parent;
                    if (!grandparent || !COUNTRIES[grandparent.name.toLowerCase()]) {
                        if (!checking) {
                            new Notice('No country folder');
                        }
                        return false;
                    }

                    displayName = directory.name;
                    country = grandparent.name.toLowerCase();
                } else {
                    displayName = activeFile.basename;
                    country = directory.name.toLowerCase();
                }

                if (country !== this.settings.defaultCountry) {
                    displayName += ` ${COUNTRIES[country]}`;
                }

                const currentDate = moment();
                const lineToInsert = `- [[${activeFile.path}|${displayName}]] - ${currentDate.format('DD.MM.YY')}`;

                if (!checking) {
                    this.insertLink(lineToInsert, displayName);
                }

                return true;
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new AutoLinkSettingTab(this.app, this));
    }

    onunload() {}

    // This method assumes all the necessary checks have been done
    private async insertLink(lineText: string, activeFileName: string) {
        const targetNote = this.settings.targetNote;

        this.app.vault.cachedRead(targetNote).then((content) => {
            const lines = content.split('\n');
            const anchorIndex = lines.findIndex((line) => line === this.settings.anchorHeader);
            if (anchorIndex === -1) {
                new Notice('No anchor header found');
                return;
            }

            // Insert an empty line if this is the first entry of this month
            if (anchorIndex + 1 < lines.length) {
                const lastLine = lines[anchorIndex + 1];
                const dateMatch = lastLine.match(/\d{2}\.\d{2}\.\d{2}/);
                if (dateMatch) {
                    const lastDate = moment(dateMatch[0], 'DD.MM.YY');
                    const currentDate = moment();
                    if (!currentDate.isSame(lastDate, 'month')) {
                        lineText += '\n';
                    }
                }
            }

            // insert the link text after the anchor header
            lines.splice(anchorIndex + 1, 0, lineText);
            const newContent = lines.join('\n');
            this.app.vault.modify(targetNote, newContent).then(() => {
                new Notice(`Link to ${activeFileName} added to ${targetNote.basename}`);
            });
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class AutoLinkSettingTab extends PluginSettingTab {
    plugin: AutoLinkPlugin;

    constructor(app: App, plugin: AutoLinkPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('Target Note')
            .setDesc('Note into which the links will be inserted')
            .addButton(button => button
                .setButtonText('Select Note')
                .onClick(() => {
                    // Open file suggestion modal
                    const modal = new FileModal(this.app, 'Select a note', 'file');

                    modal.onChooseItem = (file: TFile) => {
                        // Store the full path of the selected file
                        this.plugin.settings.targetNote = file;
                        this.plugin.saveSettings();
                        this.display(); // Refresh the setting display
                    };

                    modal.open();
                })
            )
            .addText(text => text
                .setPlaceholder('No note selected')
                .setValue(this.plugin.settings.targetNote?.path || '')
                .setDisabled(true)  // Make it read-only
            );

        new Setting(containerEl)
            .setName('Default Country')
            .setDesc('Default country will not be marked with an emoji')
            .addDropdown(dropdown => dropdown
                .addOptions(Object.keys(COUNTRIES).reduce((acc: Record<string, string>, country: string) => {
                    acc[country] = country.charAt(0).toUpperCase() + country.slice(1);
                    return acc;
                }, {}))
                .setValue(this.plugin.settings.defaultCountry)
                .onChange((value) => {
                    this.plugin.settings.defaultCountry = value;
                    this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Anchor Line')
            .setDesc('Line after which the link will be inserted')
            .addText(text => text
                .setPlaceholder('No anchor line')
                .setValue(this.plugin.settings.anchorHeader || '')
                .onChange((value) => {
                    this.plugin.settings.anchorHeader = value;
                    this.plugin.saveSettings();
                })
            );
    }
}

class FileModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private title: string,
        private buttonText: string,
        private fileType: 'file' | 'folder' = 'file'
    ) {
        super(app);
        this.setPlaceholder(title);
    }

    getItems(): TFile[] {
        // Filter for markdown files or specific type
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent): void {
        // This will be overridden by the caller
    }
}
