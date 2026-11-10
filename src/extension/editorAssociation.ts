/**
 * @fileoverview VS Code の workbench.editorAssociations 設定を読み、URI に対して明示的に関連付けられたエディターを判定する。
 * 実行境界は Extension Host。設定の読み取りだけを行い、副作用はない。glob の解釈は VS Code の editor association と同じく path または basename に対する照合とする。
 */
import * as vscode from 'vscode';
import path from 'node:path';

/**
 * resourceに対して最も優先される明示的なeditor associationを取得する。
 * 複数のパターンが一致する場合は、より長い（具体的な）パターンを優先する。
 * @param uri - 関連付けを調べる文書またはリソースのURI。
 * @returns 一致した関連付けのviewType。文字列以外の設定値や一致なしの場合はundefined。
 */
export function getEditorAssociation(uri: vscode.Uri): string | undefined {
    const associations = vscode.workspace.getConfiguration('workbench')
        .get<Record<string, unknown>>('editorAssociations', {});
    const matchingAssociations = Object.entries(associations ?? {})
        .filter(([pattern, viewType]) => typeof viewType === 'string'
            && editorAssociationPatternMatches(pattern, uri))
        .sort(([leftPattern], [rightPattern]) => rightPattern.length - leftPattern.length);
    const viewType = matchingAssociations[0]?.[1];
    return typeof viewType === 'string' ? viewType : undefined;
}

/**
 * VS Codeのeditor association globを、URIのpathまたはbasenameと比較する。
 * パターンに / を含む場合は scheme 付きの path 全体、含まない場合は basename と照合する（大文字小文字は区別しない）。
 * @param pattern - workbench.editorAssociations のキーに書かれた glob。
 * @param uri - 照合するURI。
 * @returns 一致した場合はtrue。
 */
function editorAssociationPatternMatches(pattern: string, uri: vscode.Uri): boolean {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const hasPathSeparator = normalizedPattern.includes('/');
    const regexSource = globPatternToRegex(normalizedPattern);
    const regex = new RegExp('^' + regexSource + '$', 'i');
    const target = hasPathSeparator
        ? (uri.scheme + ':' + uri.path).replace(/\\/g, '/')
        : path.posix.basename(uri.path.replace(/\\/g, '/'));
    return regex.test(target);
}

/**
 * fragmentを除いたURIのresource部分が一致するかを判定する。
 * @param left - 比較元のURI。undefinedなら常に不一致。
 * @param right - 比較先のURI。
 * @returns scheme・authority・path・queryがすべて一致する場合はtrue。
 */
export function sameUriResource(left: vscode.Uri | undefined, right: vscode.Uri): boolean {
    return left !== undefined
        && left.scheme === right.scheme
        && left.authority === right.authority
        && left.path === right.path
        && left.query === right.query;
}

/**
 * editor association globのワイルドカードをRegExp本文へ変換する。
 * ** はパス区切りをまたぐ一致、* と ? は区切り内の一致として扱い、それ以外の記号はエスケープする。
 * @param pattern - / 区切りへ正規化した glob。
 * @returns ^ と $ を付ける前の正規表現本文。
 */
function globPatternToRegex(pattern: string): string {
    let result = '';
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                const isWholePathSegment = (index === 0 || pattern[index - 1] === '/')
                    && (index + 2 === pattern.length || pattern[index + 2] === '/');
                if (!isWholePathSegment) {
                    result += '[^/]*';
                    index += 1;
                    continue;
                }
                index += 1;
                if (pattern[index + 1] === '/') {
                    result += '(?:.*/)?';
                    index += 1;
                } else {
                    result += '.*';
                }
            } else {
                result += '[^/]*';
            }
            continue;
        }
        if (character === '?') {
            result += '[^/]';
            continue;
        }
        if (character === '[') {
            const close = pattern.indexOf(']', index + 1);
            if (close > index + 1) {
                const range = pattern.slice(index + 1, close);
                result += `[${range.startsWith('!') ? `^${range.slice(1)}` : range}]`;
                index = close;
                continue;
            }
        }
        if (character === '{') {
            const close = pattern.indexOf('}', index + 1);
            if (close > index + 1) {
                const alternatives = pattern.slice(index + 1, close).split(',');
                result += `(?:${alternatives.map(globPatternToRegex).join('|')})`;
                index = close;
                continue;
            }
        }
        result += /[.+^$()|{}\\]/.test(character) ? `\\${character}` : character;
    }
    return result;
}
