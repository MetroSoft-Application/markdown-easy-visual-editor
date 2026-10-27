/**
 * Local-file-only VS Code host adapter for the conversion CLI.
 * Keep this boundary small: it lets the CLI reuse the existing HTML/PDF engines
 * without loading the VS Code extension host.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let outputPath: string | undefined;
let workspaceRoot: string | undefined;
let browserPath: string | undefined;

export function configureCliHost(config: {
    outputPath?: string;
    workspaceRoot?: string;
    browserPath?: string;
}): void {
    outputPath = config.outputPath ? path.resolve(config.outputPath) : undefined;
    workspaceRoot = config.workspaceRoot ? path.resolve(config.workspaceRoot) : undefined;
    browserPath = config.browserPath;
}

/** Minimal file URI, limited to the methods used by the current exporters. */
export class Uri {
    readonly scheme = 'file';
    readonly authority = '';
    readonly query = '';
    readonly fragment = '';

    private constructor(readonly fsPath: string) {}

    get path(): string {
        return this.fsPath.replace(/\\/g, '/');
    }

    static file(value: string): Uri {
        return new Uri(path.resolve(value));
    }

    static parse(value: string): Uri {
        if (!/^file:/i.test(value)) throw new Error('CLI supports only file: URIs.');
        return Uri.file(fileURLToPath(value));
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
        return Uri.file(path.join(base.fsPath, ...segments));
    }

    with(change: { path?: string }): Uri {
        return change.path === undefined ? this : Uri.file(change.path);
    }

    toString(): string {
        return pathToFileURL(this.fsPath).toString();
    }
}

export const window = {
    async showSaveDialog(): Promise<Uri | undefined> {
        return outputPath ? Uri.file(outputPath) : undefined;
    }
};

export const workspace = {
    fs: {
        readFile: async (uri: Uri): Promise<Uint8Array> => fs.readFile(uri.fsPath)
    },
    getWorkspaceFolder(uri: Uri): { uri: Uri } | undefined {
        if (!workspaceRoot) return undefined;
        const relative = path.relative(workspaceRoot, uri.fsPath);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            return undefined;
        }
        return { uri: Uri.file(workspaceRoot) };
    },
    getConfiguration(_section?: string): {
        get<T>(key: string, fallback: T): T
    } {
        return {
            get<T>(key: string, fallback: T): T {
                return key === 'pdf.browserPath' && browserPath ? browserPath as T : fallback;
            }
        };
    }
};
