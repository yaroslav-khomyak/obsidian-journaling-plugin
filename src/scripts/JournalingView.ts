import { type App, type TAbstractFile, type Vault, TFile } from "obsidian";
import { moment } from "obsidian";
import type JournalingPlugin from "../main";

let intervalId: number;

// Helper function: Normalize a configured path to a vault-relative folder path.
// The vault root can be written as "/", "\", "." or "./" and normalizes to "".
function normalizeSourcePath(path: string): string {
    const trimmed = path.trim().replace(/\\/g, "/");
    const withoutSlashes = trimmed.replace(/^\/+|\/+$/g, "");
    return withoutSlashes === "." ? "" : withoutSlashes;
}

// Scan the directories for changes and update the journaling files accordingly
async function scanDirectories(
    vault: Vault,
    paths: string[],
    fileName: string,
    dateFormat: string,
    filterValue: string,
) {
    for (const path of paths) {
        const journalingFilePath: string = path
            ? `${path}/${fileName}`
            : fileName;
        const targetFile: TAbstractFile | null =
            vault.getAbstractFileByPath(journalingFilePath);

        if (targetFile instanceof TFile) {
            const files: TFile[] = await getPathsByDate(
                vault,
                path,
                dateFormat,
            );

            // Sort files by date based on filterValue
            files.sort((a, b) => {
                const fileNameWithoutExtA = a.name.replace(".md", "");
                const fileNameWithoutExtB = b.name.replace(".md", "");

                const dateA = moment.utc(fileNameWithoutExtA, dateFormat);
                const dateB = moment.utc(fileNameWithoutExtB, dateFormat);

                return filterValue === "new"
                    ? dateB.diff(dateA)
                    : dateA.diff(dateB);
            });

            // Read the current content of the journaling file
            try {
                let content = await vault.read(targetFile);

                // Remove existing links and rebuild them
                content = files.reduce((acc, file) => {
                    return acc.includes(`![[${file.path}]]`)
                        ? acc
                        : acc + `![[${file.path}]]\n\n`;
                }, "");

                await vault.modify(targetFile, content);
            } catch (error) {
                console.error(
                    `Failed to update journaling file: ${targetFile.path}`,
                    error,
                );
            }
        } else {
            // Create the journaling file if it doesn't exist yet
            await createJournaling(vault, journalingFilePath);
        }
    }
}

// Helper function: Create a new journaling file
async function createJournaling(vault: Vault, filePath: string) {
    try {
        await vault.create(filePath, "");
    } catch (error) {
        console.error(`Failed to create journaling file: ${filePath}`, error);
    }
}

// Helper function: Get all daily note paths based on the date format (YYYY-MM-DD)
// An empty path means the vault root, so every markdown file is a candidate.
async function getPathsByDate(
    vault: Vault,
    path: string,
    dateFormat: string,
): Promise<TFile[]> {
    const prefix = path ? `${path}/` : "";
    const files = vault.getMarkdownFiles().filter((file) => {
        const fileNameWithoutExt = file.name.replace(".md", "");
        const parsedDate = moment.utc(fileNameWithoutExt, dateFormat, true);
        return file.path.startsWith(prefix) && parsedDate.isValid();
    });
    return files;
}

// Function to periodically scan directories for changes
function startMonitoring(
    vault: Vault,
    paths: string[],
    fileName: string,
    updateInterval: number,
    dateFormat: string,
    filterValue: string,
) {
    if (intervalId) window.clearInterval(intervalId);

    intervalId = window.setInterval(async () => {
        await scanDirectories(vault, paths, fileName, dateFormat, filterValue);
    }, updateInterval);

    return intervalId;
}

export default async function journalingView(
    app: App,
    plugin: JournalingPlugin,
) {
    const rawPaths: string = plugin.settings.paths.trim();
    const dateFormat: string = plugin.settings.dateFormat.trim();
    const fileName: string = plugin.settings.fileName.trim();
    const filterValue: string = plugin.settings.filterValue;
    const updateInterval: number = plugin.settings.updateInterval * 1000;

    if (rawPaths.length > 0 && fileName.length > 0 && updateInterval >= 1000) {
        // Drop empty segments ("a,,b") before normalizing, so that only an
        // explicit "/" (or ".") resolves to the vault root.
        const paths: string[] = [
            ...new Set(
                rawPaths
                    .split(",")
                    .filter((segment) => segment.trim().length > 0)
                    .map(normalizeSourcePath),
            ),
        ];
        const vault: Vault = app.vault;

        // Start the monitoring process and return the new interval ID
        return startMonitoring(
            vault,
            paths,
            fileName,
            updateInterval,
            dateFormat,
            filterValue,
        );
    } else {
        return intervalId;
    }
}
