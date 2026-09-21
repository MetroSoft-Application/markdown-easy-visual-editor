import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FONT_ENUMERATION_TIMEOUT_MS = 5_000;
const FONT_ENUMERATION_MAX_BUFFER = 1024 * 1024;

interface FontCommandOptions {
    windowsHide: boolean;
    timeout: number;
    maxBuffer: number;
    encoding: 'utf8';
}

export interface FontEnumerationOptions {
    platform?: NodeJS.Platform;
    commandRunner?: (
        file: string,
        args: string[],
        options: FontCommandOptions
    ) => Promise<{ stdout: string }>;
}

const defaultCommandRunner: NonNullable<FontEnumerationOptions['commandRunner']> = (
    file,
    args,
    options
) => execFileAsync(file, args, options) as Promise<{ stdout: string }>;

/** Windowsのフォント列挙結果をファミリー名単位へ正規化する。 */
export function normalizeInstalledFontNames(values: readonly string[]): string[] {
    const names = new Map<string, string>();
    for (const value of values) {
        const name = value.trim();
        if (!name) continue;
        const key = name.toLocaleLowerCase();
        if (!names.has(key)) names.set(key, name);
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

/** PowerShellの1行1ファミリー名出力を検証し、空行を除去する。 */
export function parseInstalledFontNames(output: string): string[] {
    return normalizeInstalledFontNames(output.split(/\r?\n/));
}

function powershellPath(): string {
    const systemRoot = process.env.SystemRoot;
    return systemRoot
        ? path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
}

/**
 * Windows GDI+のInstalledFontCollectionからファミリー名だけを取得する。
 * 呼び出し側で遅延実行するため、通常の拡張機能起動にはプロセス生成を追加しない。
 */
export async function enumerateInstalledFontFamilies(
    options: FontEnumerationOptions = {}
): Promise<readonly string[]> {
    if ((options.platform ?? process.platform) !== 'win32') return [];
    const commandRunner = options.commandRunner ?? defaultCommandRunner;
    const script = [
        "$ErrorActionPreference = 'Stop'",
        '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
        'Add-Type -AssemblyName System.Drawing',
        '[System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object { $_.Name }'
    ].join('; ');
    try {
        const result = await commandRunner(
            powershellPath(),
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
            {
                windowsHide: true,
                timeout: FONT_ENUMERATION_TIMEOUT_MS,
                maxBuffer: FONT_ENUMERATION_MAX_BUFFER,
                encoding: 'utf8'
            }
        );
        return parseInstalledFontNames(result.stdout);
    } catch {
        return [];
    }
}

/** 列挙結果をExtension Host内で共有し、設定タブ初回表示後の再実行を防ぐ。 */
export class InstalledFontCatalog {
    private cached?: Promise<readonly string[]>;

    constructor(private readonly enumerate: () => Promise<readonly string[]> = enumerateInstalledFontFamilies) {}

    getFonts(): Promise<readonly string[]> {
        this.cached ??= this.enumerate().catch(() => []);
        return this.cached;
    }
}
