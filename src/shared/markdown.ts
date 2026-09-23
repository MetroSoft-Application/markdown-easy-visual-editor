/**
 * @fileoverview Markdownの解析、インライン構文、表、画像、リンクの共通変換を提供する。表示と保存で本文の意味をそろえる。
 */
import { marked, type Token, type Tokens } from 'marked';
import { getMessages, type SupportedLanguage } from './messages';
import { stripMveTextColorMarkup } from './textColor';

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface TextSelection {

    /**
     * Markdownのfromを表す数値。
     */
    from: number;

    /**
     * Markdownのtoを表す数値。
     */
    to: number;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface SourceEdit {

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * Markdownのselectionに関する状態または設定。
     */
    selection: TextSelection;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface OutlineItem {

    /**
     * Markdownのlevelを表す数値。
     */
    level: number;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    line: number;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    offset: number;

    /**
     * Markdownで扱うidの文字列。
     */
    id: string;
}

/**
 * Markdownで扱う値の種類と境界を表す型。
 */
export type OutlineMovePosition = 'before' | 'after';

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface MarkdownBlock {

    /**
     * Markdownのfromを表す数値。
     */
    from: number;

    /**
     * Markdownのtoを表す数値。
     */
    to: number;

    /**
     * Markdownで扱うrawの文字列。
     */
    raw: string;

    /**
     * Markdownで対象や分岐を識別する値の型。
     */
    type: string;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface Diagnostic {

    /**
     * Markdownのseverityに関する状態または設定。
     */
    severity: 'error' | 'warning' | 'info';

    /**
     * Markdownで扱うcodeの文字列。
     */
    code: string;

    /**
     * HostとWebviewの間で受け渡すメッセージ。
     */
    message: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    line?: number;

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source?: string;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface DiagnosticSummary {

    /**
     * Markdownのerrorsに関する状態または設定。
     */
    errors: Diagnostic[];

    /**
     * Markdownのwarningsに関する状態または設定。
     */
    warnings: Diagnostic[];

    /**
     * Markdownのinfosに関する状態または設定。
     */
    infos: Diagnostic[];
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
export interface LocalResourceReference {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'image' | 'link';

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    line: number;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
interface LocalResourceDefinition {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'image' | 'link';

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    line: number;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
interface ScannedResourceLink {

    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'image' | 'link';

    /**
     * 解析・描画・変換の起点となる本文。
     */
    source?: string;

    /**
     * Markdownで扱うreference・labelの文字列。
     */
    referenceLabel?: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    offset: number;
}


/**
 * Markdownの位置・寸法・件数・時間を表す数値。
 */
const INLINE_MARKERS: Array<[RegExp, string]> = [
    [/\*\*([^\n]+?)\*\*/g, '$1'],
    [/__([^\n]+?)__/g, '$1'],
    [/~~([^\n]+?)~~/g, '$1'],
    [/==([^\n]+?)==/g, '$1'],
    [/\+\+([^\n]+?)\+\+/g, '$1'],
    [/`([^`\n]+?)`/g, '$1'],
    [/\^([^\^\n]+?)\^/g, '$1'],
    [/~([^~\n]+?)~/g, '$1'],
    [/\*([^*\n]+?)\*/g, '$1'],
    [/_([^_\n]+?)_/g, '$1']
];

/**
 * Markdownのwrap・selectionを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @param prefix - Markdownの位置・寸法・件数・時間を表す数値。
 * @param suffix - Markdownの位置・寸法・件数・時間を表す数値。
 * @param placeholder - 入力欄に値がないときに表示する案内文。
 * @returns Markdownのwrap・selectionが生成する結果。
 */
export function wrapSelection(
    source: string,
    selection: TextSelection,
    prefix: string,
    suffix = prefix,
    placeholder = 'テキスト'
): SourceEdit {
    // 選択範囲を正規化し、選択文字列またはプレースホルダーを装飾文字で囲む。
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    const selectedSource = source.slice(from, to);
    const selected = selectedSource || placeholder;
    const hasSelection = selectedSource.length > 0;
    const before = hasSelection && !/^\s/.test(selectedSource) && from > 0 && !/\s/.test(source[from - 1]) ? ' ' : '';
    const after = hasSelection && !/\s$/.test(selectedSource) && to < source.length && !/\s/.test(source[to]) ? ' ' : '';
    const replacement = `${before}${prefix}${selected}${suffix}${after}`;
    return {
        text: source.slice(0, from) + replacement + source.slice(to),
        selection: {
            from: from + before.length + prefix.length,
            to: from + before.length + prefix.length + selected.length
        }
    };
}

/**
 * Markdownのprefix・selected・linesを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @param prefix - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
export function prefixSelectedLines(
    source: string,
    selection: TextSelection,
    prefix: string
): SourceEdit {
    // 選択範囲に含まれる行を取得し、各行の先頭にプレフィックスを付けるか外す。
    const from = lineStart(source, Math.min(selection.from, selection.to));
    const to = lineEnd(source, Math.max(selection.from, selection.to));
    const original = source.slice(from, to);
    const lines = original.split('\n');
    const caretOnly = selection.from === selection.to;
    const allPrefixed = lines.every(
        /**
         * lineをtrimへ渡し、Markdownの結果または副作用を処理する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @returns 条件が成立したかを示す真偽値。
         */
        (line) => !line.trim() || line.startsWith(prefix));
    const changed = lines
        .map(
            /**
             * 各lineからtrimを取り出して一覧化する。
             * @param line - lineのtrimを参照する走査対象。
             * @returns trimを取り出した変換結果の一覧。
             */
            (line) => {
                if (!line.trim()) return caretOnly && lines.length === 1 ? prefix + line : line;
                if (line.startsWith(prefix)) return allPrefixed ? line.slice(prefix.length) : line;
                return prefix + line;
            })
        .join('\n');
    return {
        text: source.slice(0, from) + changed + source.slice(to),
        selection: caretOnly
            ? { from: selection.from + changed.length - original.length, to: selection.from + changed.length - original.length }
            : mapLineSelection(original, changed, from, selection)
    };
}

/**
 * Markdownのindent・selected・linesを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @returns Markdownのindent・selected・linesが生成する結果。
 */
export function indentSelectedLines(source: string, selection: TextSelection): SourceEdit {
    const from = lineStart(source, Math.min(selection.from, selection.to));
    const to = lineEnd(source, Math.max(selection.from, selection.to));
    const original = source.slice(from, to);
    const lines = original.split('\n');
    const caretOnly = selection.from === selection.to;
    const changed = lines
        .map(
            /**
             * 各lineからtrimを取り出して一覧化する。
             * @param line - lineのtrimを参照する走査対象。
             * @returns trimを取り出した変換結果の一覧。
             */
            (line) => {
                if (!line.trim()) return caretOnly && lines.length === 1 ? `  ${line}` : line;
                return `  ${line}`;
            })
        .join('\n');
    return {
        text: source.slice(0, from) + changed + source.slice(to),
        selection: caretOnly
            ? { from: selection.from + 2, to: selection.from + 2 }
            : mapLineSelection(original, changed, from, selection)
    };
}

/**
 * Markdownのprefix・ordered・listを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
export function prefixOrderedList(source: string, selection: TextSelection): SourceEdit {
    // 選択行がすべて番号付きリストなら番号を外し、それ以外なら連番を付ける。
    const from = lineStart(source, Math.min(selection.from, selection.to));
    const to = lineEnd(source, Math.max(selection.from, selection.to));
    const original = source.slice(from, to);
    const lines = original.split('\n');
    const caretOnly = selection.from === selection.to;
    const ordered = /^\s*\d+[.)]\s+/;
    const allOrdered = lines.every(
        /**
         * lineをtrimへ渡し、Markdownの結果または副作用を処理する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @returns 条件が成立したかを示す真偽値。
         */
        (line) => !line.trim() || ordered.test(line));
    const changed = caretOnly && lines.length === 1 && !lines[0].trim()
        ? [`${orderedListNumberBefore(source, from)}. `]
        : allOrdered
            ? lines.map(
                /**
                 * 各lineからreplaceを取り出して一覧化する。
                 * @param line - lineのreplaceを参照する走査対象。
                 * @returns replaceを取り出した変換結果の一覧。
                 */
                (line) => line.replace(/^(\s*)\d+[.)]\s+/, '$1'))
            : orderedListLines(lines, orderedListNumberBefore(source, from));
    const text = changed.join('\n');
    return {
        text: source.slice(0, from) + text + source.slice(to),
        selection: caretOnly
            ? { from: selection.from + text.length - original.length, to: selection.from + text.length - original.length }
            : mapLineSelection(original, text, from, selection)
    };
}

/**
 * Markdownのmap・line・selectionを処理し、呼び出し側へ結果または副作用を返す。
 * @param original - Markdownで受け渡す文字列。
 * @param changed - Markdownで受け渡す文字列。
 * @param regionFrom - Markdownで扱う数値。
 * @param selection - Markdownへ渡す入力。
 * @returns Markdownで生成または変換した値。
 */
export function mapLineSelection(
    original: string,
    changed: string,
    regionFrom: number,
    selection: TextSelection
): TextSelection {
    const oldLines = original.split('\n');
    const newLines = changed.split('\n');


    const mapOffset = /**
     * Markdownのmap・offsetを処理し、呼び出し側へ結果または副作用を返す。
     * @param absolute - Markdownで扱う数値。
     * @returns Markdownで利用する数値。
     */ (absolute: number): number => {
            const relative = Math.max(0, Math.min(original.length, absolute - regionFrom));
            let oldCursor = 0;
            let newCursor = 0;
            for (let index = 0; index < oldLines.length; index += 1) {
                const oldLine = oldLines[index] ?? '';
                const newLine = newLines[index] ?? '';
                const oldLineEnd = oldCursor + oldLine.length;
                if (relative <= oldLineEnd || index === oldLines.length - 1) {
                    const lineOffset = Math.max(0, Math.min(oldLine.length, relative - oldCursor));
                    return regionFrom + newCursor + mapLineOffset(oldLine, newLine, lineOffset);
                }
                oldCursor = oldLineEnd + 1;
                newCursor += newLine.length + 1;
            }
            return regionFrom + changed.length;
        };
    return {
        from: mapOffset(selection.from),
        to: mapOffset(selection.to)
    };
}

/**
 * Markdownのmap・line・offsetを処理し、呼び出し側へ結果または副作用を返す。
 * @param original - Markdownで受け渡す文字列。
 * @param changed - Markdownで受け渡す文字列。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function mapLineOffset(original: string, changed: string, offset: number): number {
    if (original === changed) return offset;
    let suffixLength = 0;
    while (
        suffixLength < original.length
        && suffixLength < changed.length
        && original.charCodeAt(original.length - suffixLength - 1) === changed.charCodeAt(changed.length - suffixLength - 1)
    ) {
        suffixLength += 1;
    }
    const originalPrefixLength = original.length - suffixLength;
    const changedPrefixLength = changed.length - suffixLength;
    if (offset <= originalPrefixLength) return changedPrefixLength;
    return Math.max(0, Math.min(changed.length, offset + changedPrefixLength - originalPrefixLength));
}

/**
 * Markdownのordered・list・linesを処理し、呼び出し側へ結果または副作用を返す。
 * @param lines - Markdownの位置・寸法・件数・時間を表す数値。
 * @param firstNumber - Markdownで扱う数値。
 * @returns Markdownで利用する文字列。
 */
function orderedListLines(lines: string[], firstNumber: number): string[] {
    // 空行とインデントを維持しながら、各行へ開始番号からの連番を付ける。
    let number = firstNumber;
    return lines.map(
        /**
         * 各lineからtrimを取り出して一覧化する。
         * @param line - lineのtrimを参照する走査対象。
         * @returns trimを取り出した変換結果の一覧。
         */
        (line) => {
            if (!line.trim()) return line;
            const indentation = line.match(/^\s*/)?.[0] ?? '';
            const content = line.slice(indentation.length).replace(/^(?:[-+*]|\d+[.)])\s+/, '');
            const result = `${indentation}${number}. ${content}`;
            number += 1;
            return result;
        });
}

/**
 * Markdownのordered・list・number・beforeを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param from - Markdownで扱う数値。
 * @returns Markdownで利用する数値。
 */
function orderedListNumberBefore(source: string, from: number): number {
    // 対象行の直前にある番号付きリストを読み取り、次に使う番号を計算する。
    const previousLine = source.slice(0, Math.max(0, from - 1)).split(/\r?\n/).at(-1) ?? '';
    const match = previousLine.match(/^\s*(\d+)[.)]\s+/);
    const previousNumber = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(previousNumber) ? previousNumber + 1 : 1;
}

/**
 * Markdownの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @returns Markdownのclear・inline・formattingが生成する結果。
 */
export function clearInlineFormatting(source: string, selection: TextSelection): SourceEdit {
    // 選択範囲のリンク先を一時退避し、本文中のインライン装飾記号だけを取り除く。
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    let selected = source.slice(from, to);
    if (!selected) return { text: source, selection: { from, to } };
    const protectedTargets: string[] = [];
    // リンク先をプレースホルダーへ置き換え、装飾除去の対象から外す。
    selected = selected.replace(/(\]\()([^)]+)(\))/g,
        /**
         * ・matchを一覧追加へ渡し、Markdownの結果または副作用を処理する。
         * @param _match - Markdownへ渡す入力。
         * @param open - Markdownで受け渡す文字列。
         * @param target - Markdownで受け渡す文字列。
         * @param close - Markdownで受け渡す文字列。
         * @returns Markdownのコールバックが生成する結果。
         */
        (_match, open: string, target: string, close: string) => {
            const index = protectedTargets.push(target) - 1;
            return `${open}\uE000${index}\uE001${close}`;
        });
    for (const [pattern, replacement] of INLINE_MARKERS) {
        // 定義済みの装飾パターンを順番に適用して、記号を内容へ置き換える。
        selected = selected.replace(pattern, replacement);
    }
    // 退避していたリンク先を元の位置へ戻す。
    selected = selected.replace(/\uE000(\d+)\uE001/g,
        /**
         * ・matchをnumberへ渡し、Markdownの結果または副作用を処理する。
         * @param _match - Markdownへ渡す入力。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns Markdownのコールバックが生成する結果。
         */
        (_match, index: string) => protectedTargets[Number(index)] ?? '');
    return {
        text: source.slice(0, from) + selected + source.slice(to),
        selection: { from, to: from + selected.length }
    };
}

/**
 * Markdownの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param selection - Markdownへ渡す入力。
 * @returns Markdownのclear・block・formattingが生成する結果。
 */
export function clearBlockFormatting(source: string, selection: TextSelection): SourceEdit {
    // 選択行を取り出し、コードフェンス・見出し・引用・リスト・インデントの記号を除去する。
    const selectionFrom = Math.min(selection.from, selection.to);
    const selectionTo = Math.max(selection.from, selection.to);
    if (selectionFrom === selectionTo) return { text: source, selection: { from: selectionFrom, to: selectionTo } };
    const from = lineStart(source, selectionFrom);
    const to = lineEnd(source, selectionTo);
    let lines = source.slice(from, to).split('\n');
    // 選択範囲全体がコードフェンスで囲まれている場合は、外側のフェンスを先に外す。
    if (lines.length >= 2 && /^\s*`{3,}[^`]*$/.test(lines[0]) && /^\s*`{3,}\s*$/.test(lines.at(-1) ?? '')) {
        lines = lines.slice(1, -1);
    }
    const changed = lines
        .map(
            /**
             * 各lineからreplaceを取り出して一覧化する。
             * @param line - lineのreplaceを参照する走査対象。
             * @returns replaceを取り出した変換結果の一覧。
             */
            (line) =>
                line
                    .replace(/^\s{0,3}#{1,6}\s+/, '')
                    .replace(/^\s*>\s?/, '')
                    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
                    .replace(/^\s{4}/, '')
        )
        .join('\n');
    return {
        text: source.slice(0, from) + changed + source.slice(to),
        selection: { from, to: from + changed.length }
    };
}

/**
 * Markdownで使う値または実行環境を組み立てる。
 * @param rows - Markdownで走査または更新する要素。
 * @param columns - Markdownで走査または更新する要素。
 * @returns Markdownで利用する文字列。
 */
export function createTableMarkdown(rows = 3, columns = 3): string {
    // 行数と列数を許容範囲へ収め、見出し・区切り・空の本文行から表を生成する。
    const safeRows = Math.max(2, Math.min(rows, 50));
    const safeColumns = Math.max(1, Math.min(columns, 20));
    const header = `| ${Array.from({ length: safeColumns },
        /**
         * Markdownのコールバックとして・を処理する。
         * @param _ - 引数位置を維持するための未使用値。
         * @param i - Markdownへ渡す入力。
         * @returns Markdownのコールバックが生成する結果。
         */
        (_, i) => `列${i + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: safeColumns },
        /**
         * Markdownのコールバックとして要素を処理する。
         * @returns Markdownのコールバックが生成する結果。
         */
        () => '---').join(' | ')} |`;
    const body = Array.from(
        { length: safeRows - 1 },

        /**
         * 要素をfromへ渡し、Markdownの結果または副作用を処理する。
         * @returns Markdownのコールバックが生成する結果。
         */
        () => `| ${Array.from({ length: safeColumns },
            /**
             * Markdownのコールバックとして要素を処理する。
             * @returns Markdownのコールバックが生成する結果。
             */
            () => '').join(' | ')} |`
    );
    return [header, divider, ...body].join('\n');
}

/**
 * Markdownで扱う値の種類と境界を表す型。
 */
export type MarkdownTableAction =
    | 'rowBefore'
    | 'rowAfter'
    | 'deleteRow'
    | 'colBefore'
    | 'colAfter'
    | 'deleteColumn'
    | 'header'
    | 'alignLeft'
    | 'alignCenter'
    | 'alignRight'
    | 'alignColumns';

/**
 * Markdownへ渡す設定項目と既定値のデータ形状。
 */
export interface MarkdownTableActionOptions {

    /**
     * Markdownで扱うheader・nameの文字列。
     */
    headerName?: string;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
interface ParsedMarkdownTable {

    /**
     * Markdownで扱うlinesの一覧。
     */
    lines: string[];

    /**
     * Markdownのline・startsを表す数値。
     */
    lineStarts: number[];

    /**
     * Markdownで扱うeolの文字列。
     */
    eol: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    startLine: number;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    endLine: number;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    separatorLine: number;

    /**
     * Markdownで扱うrowsの一覧。
     */
    rows: string[][];

    /**
     * Markdownで扱うseparatorの文字列。
     */
    separator: string[];

    /**
     * Markdownで扱うindentの文字列。
     */
    indent: string;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    rowIndex: number;

    /**
     * Markdownの位置・寸法・件数・時間を表す数値。
     */
    columnIndex: number;
}

/**
 * Markdownの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownへ渡す入力。
 * @param action - Markdownへ渡す入力。
 * @param options - 呼び出し側が指定する処理設定。
 * @returns 副作用を完了し、値は返さない。
 */
export function applyMarkdownTableAction(
    markdown: string,
    selection: TextSelection,
    action: MarkdownTableAction,
    options: MarkdownTableActionOptions = {}
): SourceEdit | undefined {
    // 選択位置を含むGFM表を解析し、操作対象の行・列を複製して編集する。
    const table = parseMarkdownTable(markdown, selection);
    if (!table) return undefined;

    const rows = table.rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    const separator = table.separator.slice();
    let rowIndex = table.rowIndex;
    const columnIndex = table.columnIndex;

    // 指定された操作に応じて行・列・見出し・配置を変更する。
    switch (action) {
        case 'rowBefore':
            rows.splice(rowIndex, 0, Array.from({ length: separator.length },
                /**
                 * Markdownのコールバックとして要素を処理する。
                 * @returns Markdownのコールバックが生成する結果。
                 */
                () => ''));
            break;
        case 'rowAfter':
            rows.splice(rowIndex + 1, 0, Array.from({ length: separator.length },
                /**
                 * Markdownのコールバックとして要素を処理する。
                 * @returns Markdownのコールバックが生成する結果。
                 */
                () => ''));
            rowIndex += 1;
            break;
        case 'deleteRow':
            if (rows.length <= 1) return undefined;
            rows.splice(rowIndex, 1);
            rowIndex = Math.min(rowIndex, rows.length - 1);
            break;
        case 'colBefore':
            rows.forEach(
                /**
                 * 行ごとにspliceを実行する。
                 * @param row - 行のspliceを参照する走査対象。
                 * @param index - 配列・行列・文字列の要素位置を示す番号。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (row, index) => row.splice(columnIndex, 0, index === 0 ? newColumnHeader(options.headerName, columnIndex + 1) : ''));
            separator.splice(columnIndex, 0, '---');
            break;
        case 'colAfter':
            rows.forEach(
                /**
                 * 行ごとにspliceを実行する。
                 * @param row - 行のspliceを参照する走査対象。
                 * @param index - 配列・行列・文字列の要素位置を示す番号。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (row, index) => row.splice(columnIndex + 1, 0, index === 0 ? newColumnHeader(options.headerName, columnIndex + 2) : ''));
            separator.splice(columnIndex + 1, 0, '---');
            break;
        case 'deleteColumn':
            if (separator.length <= 1) return undefined;
            for (const row of rows) row.splice(columnIndex, 1);
            separator.splice(columnIndex, 1);
            break;
        case 'header':
            if (rowIndex === 0) return undefined;
            [rows[0], rows[rowIndex]] = [rows[rowIndex], rows[0]];
            rowIndex = 0;
            break;
        case 'alignLeft':
            separator[columnIndex] = ':---';
            break;
        case 'alignCenter':
            separator[columnIndex] = ':---:';
            break;
        case 'alignRight':
            separator[columnIndex] = '---:';
            break;
        case 'alignColumns': {
            // 各列の表示幅を求め、本文セルと区切りセルを同じ幅に揃える。
            const widths = Array.from({ length: separator.length },
                /**
                 * ・をmaxへ渡し、Markdownの結果または副作用を処理する。
                 * @param _ - 引数位置を維持するための未使用値。
                 * @param index - 配列・行列・文字列の要素位置を示す番号。
                 * @returns 副作用を完了し、値は返さない。
                 */
                (_, index) =>
                    Math.max(
                        3,
                        displayWidth(stripMveTextColorMarkup(separator[index] ?? '')),
                        ...rows.map(
                            /**
                             * 各行をdisplay・widthへ渡し、変換結果を一覧化する。
                             * @param row - 走査中の要素。
                             * @returns 入力要素から生成した変換結果の一覧。
                             */
                            (row) => displayWidth(stripMveTextColorMarkup(row[index] ?? '')))
                    )
            );
            for (const row of rows) {
                for (let index = 0; index < widths.length; index += 1) {
                    row[index] = padDisplayWidth(row[index] ?? '', widths[index]);
                }
            }
            for (let index = 0; index < widths.length; index += 1) {
                separator[index] = padDisplayWidth(separator[index] ?? '---', widths[index]);
            }
            break;
        }
    }

    return renderMarkdownTableEdit(markdown, table, rows, separator, rowIndex, columnIndex);
}

/**
 * Markdownの入力を構造化した値へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownでselectionとして扱う入力。
 * @returns 副作用を完了し、値は返さない。
 */
function parseMarkdownTable(markdown: string, selection: TextSelection): ParsedMarkdownTable | undefined {
    // 改行位置を記録しながら、選択行を含む連続した表の範囲を特定する。
    const lineBreaks = [...markdown.matchAll(/\r\n|\r|\n/g)].map(
        /**
         * 各matchを変換して一覧化する。
         * @param match - Markdownへ渡す入力。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (match) => match[0]);
    const eol = lineBreaks[0] ?? '\n';
    const lines = markdown.split(/\r\n|\r|\n/);
    const lineStarts: number[] = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        lineStarts.push(offset);
        offset += lines[index].length + (lineBreaks[index]?.length ?? 0);
    }

    const currentLine = findLineIndex(lineStarts, selection.from);
    if (!isTableRowLine(lines[currentLine])) return undefined;
    if (isInsideMarkdownFence(lines, currentLine)) return undefined;
    let startLine = currentLine;
    let endLine = currentLine;
    while (startLine > 0 && isTableRowLine(lines[startLine - 1])) startLine -= 1;
    while (endLine + 1 < lines.length && isTableRowLine(lines[endLine + 1])) endLine += 1;

    const separatorLine = lines.findIndex(
        /**
         * lineをis・table・separator・lineへ渡し、Markdownの結果または副作用を処理する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns Markdownのコールバックが生成する結果。
         */
        (line, index) => index >= startLine && index <= endLine && isTableSeparatorLine(line));
    if (separatorLine < 0) return undefined;
    if (separatorLine !== startLine + 1 || !isTableRowLine(lines[startLine])) return undefined;

    // 区切り行を除いた本文行をセルへ分割し、すべての行を同じ列数へ補正する。
    const rowLines = lines
        .slice(startLine, endLine + 1)
        .map(
            /**
             * 各lineを変換して一覧化する。
             * @param line - Markdownの位置・寸法・件数・時間を表す数値。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (line, index) => ({ line, index: startLine + index }))
        .filter(
            /**
             * 条件を満たす設定だけを残す。
             * @param options - 呼び出し側が指定する処理設定。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            ({ index }) => index !== separatorLine);
    if (!rowLines.length) return undefined;

    const rows = rowLines.map(
        /**
         * 各設定をsplit・table・cellsへ渡し、変換結果を一覧化する。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        ({ line }) => splitTableCells(line));
    const separator = splitTableCells(lines[separatorLine]);
    const columnCount = Math.max(1, separator.length, ...rows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length));
    for (const row of rows) while (row.length < columnCount) row.push('');
    while (separator.length < columnCount) separator.push('---');

    const rowLineIndex = rowLines.findIndex(
        /**
         * Markdownのコールバックとして設定を処理する。
         * @param options - 呼び出し側が指定する処理設定。
         * @returns Markdownのコールバックが生成する結果。
         */
        ({ index }) => index === currentLine);
    const rowIndex = rowLineIndex < 0 ? 0 : rowLineIndex;
    const lineOffset = selection.from - lineStarts[currentLine];
    const columnIndex = tableColumnAt(lines[currentLine], lineOffset, columnCount);
    const indent = /^\s*/.exec(lines[rowLines[0].index])?.[0] ?? '';

    return {
        lines,
        lineStarts,
        eol,
        startLine,
        endLine,
        separatorLine,
        rows,
        separator,
        indent,
        rowIndex,
        columnIndex
    };
}

/**
 * Markdownを表示用の結果へ変換する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param table - Markdownへ渡す入力。
 * @param rows - Markdownで走査または更新する要素。
 * @param separator - Markdownで受け渡す文字列。
 * @param rowIndex - Markdownで走査または更新する要素。
 * @param columnIndex - Markdownで走査または更新する要素。
 * @returns Markdownで生成または変換した値。
 */
function renderMarkdownTableEdit(
    markdown: string,
    table: ParsedMarkdownTable,
    rows: string[][],
    separator: string[],
    rowIndex: number,
    columnIndex: number
): SourceEdit {
    // 編集済みの行と区切り行をMarkdownへ再出力し、選択セルの先頭へカーソルを移す。
    const renderedRows = rows.map(
        /**
         * 各行をrender・table・rowへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) => renderTableRow(table.indent, row));
    const renderedSeparator = renderTableRow(table.indent, separator);
    const renderedTable = [renderedRows[0], renderedSeparator, ...renderedRows.slice(1)];
    const startOffset = table.lineStarts[table.startLine];
    const endOffset = table.lineStarts[table.endLine] + table.lines[table.endLine].length;
    const replacement = renderedTable.join(table.eol);
    const text = markdown.slice(0, startOffset) + replacement + markdown.slice(endOffset);
    const renderedRowIndex = rowIndex === 0 ? 0 : rowIndex + 1;
    const rowPrefix = renderedTable.slice(0, renderedRowIndex).join(table.eol);
    const rowStart = startOffset + rowPrefix.length + (renderedRowIndex ? table.eol.length : 0);
    const safeColumn = Math.min(columnIndex, rows[rowIndex].length - 1);
    const cellOffset = table.indent.length + 2
        + rows[rowIndex].slice(0, safeColumn).reduce(
            /**
             * 要素を順に加算して累積値を求める。
             * @param total - 累積値へ加算する要素。
             * @param cell - 累積値へ加算する要素。
             * @returns 要素を集約した累積値。
             */
            (total, cell) => total + cell.length + 3, 0);
    const caret = rowStart + cellOffset;
    return { text, selection: { from: caret, to: caret } };
}

/**
 * Markdownの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownへ渡す入力。
 * @param tsv - Markdownで受け渡す文字列。
 * @returns 副作用を完了し、値は返さない。
 */
export function applyMarkdownTableTsv(
    markdown: string,
    selection: TextSelection,
    tsv: string
): SourceEdit | undefined {
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    if (isMarkdownCodeFencePosition(markdown, selection)) return undefined;
    const table = parseMarkdownTable(markdown, { from, to: from });
    const pastedRows = parseTsv(tsv);
    if (!pastedRows.length || !pastedRows.some(
        /**
         * Markdownのコールバックとして行を処理する。
         * @param row - Markdownで走査または更新する要素。
         * @returns 副作用を完了し、値は返さない。
         */
        (row) => row.length)) return undefined;

    if (!table) return insertMarkdownTableFromTsv(markdown, selection, pastedRows);
    const tableEnd = table.lineStarts[table.endLine] + table.lines[table.endLine].length;
    if (to > tableEnd) return insertMarkdownTableFromTsv(markdown, selection, pastedRows);
    if (table.separatorLine === findLineIndex(table.lineStarts, from)) return undefined;

    const rows = table.rows.map(
        /**
         * 各行からsliceを取り出して一覧化する。
         * @param row - 行のsliceを参照する走査対象。
         * @returns sliceを取り出した変換結果の一覧。
         */
        (row) => row.slice());
    const separator = table.separator.slice();
    const requiredRows = table.rowIndex + pastedRows.length;
    const requiredColumns = table.columnIndex + Math.max(...pastedRows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length));
    while (rows.length < requiredRows) rows.push(Array.from({ length: separator.length },
        /**
         * Markdownのコールバックとして要素を処理する。
         * @returns 条件が成立したかを示す真偽値。
         */
        () => ''));
    while (separator.length < requiredColumns) separator.push('---');
    for (const row of rows) while (row.length < separator.length) row.push('');

    for (let rowOffset = 0; rowOffset < pastedRows.length; rowOffset += 1) {
        const row = pastedRows[rowOffset];
        for (let columnOffset = 0; columnOffset < row.length; columnOffset += 1) {
            rows[table.rowIndex + rowOffset][table.columnIndex + columnOffset] = escapeMarkdownTableCell(row[columnOffset]);
        }
    }
    return renderMarkdownTableEdit(markdown, table, rows, separator, table.rowIndex, table.columnIndex);
}

/**
 * Markdownの条件を判定する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownへ渡す入力。
 * @returns 条件が成立したかを示す真偽値。
 */
export function isMarkdownCodeFencePosition(markdown: string, selection: TextSelection): boolean {
    const lines = markdown.split(/\r\n|\r|\n/);
    const lineStarts: number[] = [];
    let offset = 0;
    for (let index = 0; index < lines.length; index += 1) {
        lineStarts.push(offset);
        offset += lines[index].length + (markdown.slice(offset + lines[index].length).match(/^\r\n|^\r|^\n/)?.[0].length ?? 0);
    }
    const line = findLineIndex(lineStarts, Math.min(selection.from, selection.to));
    return isInsideMarkdownFence(lines, line);
}

/**
 * Markdownの状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownへ渡す入力。
 * @param rows - Markdownで走査または更新する要素。
 * @returns Markdownのinsert・markdown・table・from・tsvが生成する結果。
 */
function insertMarkdownTableFromTsv(markdown: string, selection: TextSelection, rows: string[][]): SourceEdit {
    const eol = markdown.match(/\r\n|\r|\n/)?.[0] ?? '\n';
    const from = Math.max(0, Math.min(selection.from, selection.to));
    const to = Math.min(markdown.length, Math.max(selection.from, selection.to));
    const columnCount = Math.max(1, ...rows.map(
        /**
         * 各行からlengthを取り出して一覧化する。
         * @param row - 行のlengthを参照する走査対象。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (row) => row.length));
    const normalizedRows = rows.map(
        /**
         * 各行をfromへ渡し、変換結果を一覧化する。
         * @param row - 走査中の要素。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (row) => Array.from({ length: columnCount },
            /**
             * ・をescape・markdown・table・cellへ渡し、Markdownの結果または副作用を処理する。
             * @param _ - 引数位置を維持するための未使用値。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns 副作用を完了し、値は返さない。
             */
            (_, index) => escapeMarkdownTableCell(row[index] ?? '')));
    const separator = Array.from({ length: columnCount },
        /**
         * Markdownのコールバックとして要素を処理する。
         * @returns 副作用を完了し、値は返さない。
         */
        () => '---');
    const rendered = [
        renderTableRow('', normalizedRows[0]),
        renderTableRow('', separator),
        ...normalizedRows.slice(1).map(
            /**
             * 各行をrender・table・rowへ渡し、変換結果を一覧化する。
             * @param row - 走査中の要素。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (row) => renderTableRow('', row))
    ].join(eol);
    const before = markdown.slice(0, from);
    const after = markdown.slice(to);
    const prefix = before.length && !before.endsWith('\n') ? eol : '';
    const suffix = after.length && !/^(?:\r\n|\r|\n)/.test(after) ? eol : '';
    const replacement = prefix + rendered + suffix;
    const text = before + replacement + after;
    const caret = from + replacement.length;
    return { text, selection: { from: caret, to: caret } };
}

/**
 * Markdownの変更または利用者の操作意図を記録し、後続処理へ渡す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param selection - Markdownへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
export function markdownTableToTsv(markdown: string, selection: TextSelection): string | undefined {
    const table = parseMarkdownTable(markdown, selection);
    if (!table || table.separatorLine === findLineIndex(table.lineStarts, selection.from)) return undefined;
    return table.rows
        .map(
            /**
             * 各行からmapを取り出して一覧化する。
             * @param row - 行のmapを参照する走査対象。
             * @returns mapを取り出した変換結果の一覧。
             */
            (row) => row.map(
                /**
                 * 各セルをencode・tsv・cellへ渡し、変換結果を一覧化する。
                 * @param cell - Markdownで走査または更新する要素。
                 * @returns 入力要素から生成した変換結果の一覧。
                 */
                (cell) => encodeTsvCell(stripMarkdownTableCell(cell))).join('\t'))
        .join('\r\n');
}

/**
 * Markdownの入力を構造化した値へ変換する。
 * @param tsv - Markdownで受け渡す文字列。
 * @returns Markdownで利用する文字列。
 */
function parseTsv(tsv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    let hasValue = false;
    for (let index = 0; index < tsv.length; index += 1) {
        const character = tsv[index];
        if (quoted) {
            if (character === '"' && tsv[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                cell += character;
            }
            hasValue = true;
            continue;
        }
        if (character === '"' && cell.length === 0) {
            quoted = true;
            hasValue = true;
        } else if (character === '\t') {
            row.push(cell);
            cell = '';
            hasValue = true;
        } else if (character === '\r' || character === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            hasValue = false;
            if (character === '\r' && tsv[index + 1] === '\n') index += 1;
        } else {
            cell += character;
            hasValue = true;
        }
    }
    if (hasValue || cell.length > 0 || row.length > 0) row.push(cell);
    if (row.length) rows.push(row);
    return rows;
}

/**
 * Markdownの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する文字列。
 */
function escapeMarkdownTableCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/[|`*_~\[\]<>]/g, '\\$&')
        .replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Markdownの条件を判定する。
 * @param lines - Markdownの位置・寸法・件数・時間を表す数値。
 * @param lineIndex - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isInsideMarkdownFence(lines: string[], lineIndex: number): boolean {
    let fenceCharacter = '';
    let fenceLength = 0;
    for (let index = 0; index <= lineIndex; index += 1) {
        const match = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
        if (!match) continue;
        const character = match[1][0];
        if (!fenceCharacter) {
            fenceCharacter = character;
            fenceLength = match[1].length;
        } else if (character === fenceCharacter && match[1].length >= fenceLength) {
            fenceCharacter = '';
            fenceLength = 0;
        }
    }
    return Boolean(fenceCharacter);
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param lines - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function getFencedMarkdownLineIndexes(lines: string[]): Set<number> {
    const fencedLineIndexes = new Set<number>();
    let fenceCharacter = '';
    let fenceLength = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
        if (fenceCharacter) {
            fencedLineIndexes.add(index);
            if (match && match[1][0] === fenceCharacter
                && match[1].length >= fenceLength
                && /^[ \t]*$/.test(match[2])) {
                fenceCharacter = '';
                fenceLength = 0;
            }
            continue;
        }
        if (!match) continue;
        fencedLineIndexes.add(index);
        fenceCharacter = match[1][0];
        fenceLength = match[1].length;
    }
    return fencedLineIndexes;
}

/**
 * Markdownから不要または危険な情報を除去する。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する文字列。
 */
function stripMarkdownTableCell(value: string): string {
    let text = value.trim()
        .replace(/\\\|/g, '|')
        .replace(/\\([\\`*_~+\[\]()<>])/g, '$1')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '');
    for (const [pattern, replacement] of INLINE_MARKERS) text = text.replace(pattern, replacement);
    return text;
}

/**
 * Markdownのencode・tsv・cellを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する文字列。
 */
function encodeTsvCell(value: string): string {
    return /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param lineStarts - Markdownの位置・寸法・件数・時間を表す数値。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function findLineIndex(lineStarts: number[], offset: number): number {
    // 行開始位置の配列を二分探索し、オフセットが属する行番号を求める。
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle - 1;
    }
    return low;
}

/**
 * Markdownの条件を判定する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isTableRowLine(line: string | undefined): boolean {
    // 空でなく区切り記号を含む行を表の行候補として判定する。
    const trimmed = line?.trim() ?? '';
    return trimmed.includes('|') && trimmed.length > 0;
}

/**
 * Markdownの条件を判定する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isTableSeparatorLine(line: string): boolean {
    // 全セルがMarkdown表の区切り形式になっているかを判定する。
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.every(
        /**
         * セルをtestへ渡し、Markdownの結果または副作用を処理する。
         * @param cell - Markdownで走査または更新する要素。
         * @returns Markdownで利用する文字列。
         */
        (cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/**
 * Markdownのsplit・table・cellsを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する文字列。
 */
function splitTableCells(line: string): string[] {
    // エスケープされていない縦棒だけを区切りとして、表のセルを分割する。
    let body = line.trim();
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
    const cells: string[] = [];
    let cell = '';
    for (let index = 0; index < body.length; index += 1) {
        const character = body[index];
        if (character === '|' && body[index - 1] !== '\\') {
            cells.push(cell.trim());
            cell = '';
        } else {
            cell += character;
        }
    }
    cells.push(cell.trim());
    return cells;
}

/**
 * Markdownのtable・column・atを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @param columnCount - Markdownで走査または更新する要素。
 * @returns Markdownで利用する数値。
 */
function tableColumnAt(line: string, offset: number, columnCount: number): number {
    // 行内の縦棒を数え、指定オフセットが属する列番号を求める。
    const firstContent = line.search(/\S/);
    let start = firstContent < 0 ? 0 : firstContent;
    if (line[start] === '|') start += 1;
    let column = 0;
    for (let index = start; index < Math.min(offset, line.length); index += 1) {
        if (line[index] === '|' && line[index - 1] !== '\\') column += 1;
    }
    return Math.max(0, Math.min(column, columnCount - 1));
}

/**
 * Markdownを表示用の結果へ変換する。
 * @param indent - Markdownで受け渡す文字列。
 * @param cells - Markdownで走査または更新する要素。
 * @returns Markdownで利用する文字列。
 */
function renderTableRow(indent: string, cells: string[]): string {
    // インデントとセル配列から、1行分のMarkdown表記を生成する。
    return indent + '| ' + cells.join(' | ') + ' |';
}

/**
 * Markdownのnew・column・headerを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param columnNumber - Markdownで走査または更新する要素。
 * @returns Markdownで利用する文字列。
 */
function newColumnHeader(value: string | undefined, columnNumber: number): string {
    // 指定された見出しを使い、空の場合は列番号から既定の見出しを作る。
    const header = value?.trim();
    return header || `列${columnNumber}`;
}

/**
 * Markdownのdisplay・widthを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する数値。
 */
function displayWidth(value: string): number {
    // 結合文字を除外し、全角文字を2幅として表示幅を数える。
    let width = 0;
    for (const character of Array.from(value)) {
        if (/\p{Mark}/u.test(character)) continue;
        const codePoint = character.codePointAt(0) ?? 0;
        width += isWideCodePoint(codePoint) ? 2 : 1;
    }
    return width;
}

/**
 * Markdownのpad・display・widthを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @param width - 表示領域または列の幅。
 * @returns Markdownで利用する文字列。
 */
function padDisplayWidth(value: string, width: number): string {
    // 現在の表示幅が指定幅に届くまで末尾へ空白を追加する。
    return value + ' '.repeat(Math.max(0, width - displayWidth(stripMveTextColorMarkup(value))));
}

/**
 * Markdownの条件を判定する。
 * @param codePoint - Markdownで扱う数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isWideCodePoint(codePoint: number): boolean {
    // コードポイントが全角表示されるUnicode範囲に含まれるかを判定する。
    return codePoint >= 0x1100 && (
        codePoint <= 0x115f
        || codePoint === 0x2329
        || codePoint === 0x232a
        || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
        || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
        || (codePoint >= 0xf900 && codePoint <= 0xfaff)
        || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
        || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
        || (codePoint >= 0xff01 && codePoint <= 0xff60)
        || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
        || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    );
}

/**
 * Markdownの入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する文字列。
 */
export function escapeMarkdownAlt(value: string): string {
    // 画像の代替テキストからMarkdown記号と改行を除去して1行へ整える。
    return value.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Markdownの入力を検証し、表示または保存に使う形式へ変換する。
 * @param path - 読み書きするファイルまたはリソースの場所。
 * @param alt - Markdownへ渡す入力。
 * @returns Markdownで利用する文字列。
 */
export function imageMarkdown(path: string, alt = getMessages('ja').editor.defaultImageAlt): string {
    // パスの区切りを正規化し、エスケープ済みの代替テキストで画像記法を作る。
    return `![${escapeMarkdownAlt(alt)}](${path.replace(/\\/g, '/')})`;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownに対応する要素の一覧。
 */
export function getOutline(markdown: string): OutlineItem[] {
    // Markdownの見出しを走査し、表示名・行番号・文書内位置・重複しないIDを収集する。
    const items: OutlineItem[] = [];
    const duplicateCount = new Map<string, number>();
    const lines = markdown.split(/\r\n|\r|\n/);
    const fencedLineIndexes = getFencedMarkdownLineIndexes(lines);
    let lineNumber = 1;
    for (const lineMatch of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
        const rawLine = lineMatch[0];
        if (!rawLine && lineMatch.index === markdown.length) break;
        const line = rawLine.replace(/(?:\r\n|\r|\n)$/, '');
        if (fencedLineIndexes.has(lineNumber - 1)) {
            lineNumber += 1;
            continue;
        }
        const match = /^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*#*\s*$/.exec(line);
        if (match) {
            // 装飾記号を除いた見出し文字列から、明示IDまたは自動生成IDを決める。
            const visible = stripMveTextColorMarkup(match[2]);
            const explicit = /\s+\{#([^}]+)\}\s*$/.exec(visible);
            const text = visible
                .replace(/\s+\{#[^}]+\}\s*$/, '')
                .replace(/[*_`~+=]/g, '')
                .trim();
            const baseId = explicit?.[1] || match[3] || slugify(text);
            const count = duplicateCount.get(baseId) ?? 0;
            duplicateCount.set(baseId, count + 1);
            items.push({
                level: match[1].length,
                text,
                line: lineNumber,
                offset: lineMatch.index,
                id: count ? `${baseId}-${count}` : baseId
            });
        }
        lineNumber += 1;
    }
    return items;
}

/**
 * Markdownの条件を判定する。
 * @param outline - Markdownの位置・寸法・件数・時間を表す数値。
 * @param sourceIndex - Markdownで扱う文字列または本文。
 * @param targetIndex - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
export function canMoveOutlineSection(
    outline: readonly OutlineItem[],
    sourceIndex: number,
    targetIndex: number
): boolean {
    if (sourceIndex === targetIndex) return false;
    const source = outline[sourceIndex];
    const target = outline[targetIndex];
    if (!source || !target) return false;
    return source.level === target.level || isOutlineEmptyParentTarget(outline, sourceIndex, targetIndex);
}

/**
 * Markdownの条件を判定する。
 * @param outline - Markdownの位置・寸法・件数・時間を表す数値。
 * @param sourceIndex - Markdownで扱う文字列または本文。
 * @param targetIndex - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
export function isOutlineEmptyParentTarget(
    outline: readonly OutlineItem[],
    sourceIndex: number,
    targetIndex: number
): boolean {
    const source = outline[sourceIndex];
    const target = outline[targetIndex];
    if (!source || !target || source.level !== target.level + 1) return false;
    const next = outline[targetIndex + 1];
    return !next || next.level <= target.level;
}

/**
 * Markdownの要素を規則に従って並べ替える。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param outline - Markdownの位置・寸法・件数・時間を表す数値。
 * @param sourceIndex - Markdownで扱う文字列または本文。
 * @param targetIndex - Markdownの位置・寸法・件数・時間を表す数値。
 * @param position - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
export function moveOutlineSection(
    markdown: string,
    outline: readonly OutlineItem[],
    sourceIndex: number,
    targetIndex: number,
    position: OutlineMovePosition
): string | undefined {
    if (!canMoveOutlineSection(outline, sourceIndex, targetIndex)) return undefined;
    const source = outline[sourceIndex];
    const target = outline[targetIndex];
    const sourceTo = findOutlineSectionEnd(markdown, outline, sourceIndex);
    const targetTo = findOutlineSectionEnd(markdown, outline, targetIndex);
    if (source.offset < 0 || source.offset > markdown.length
        || sourceTo < source.offset || sourceTo > markdown.length
        || target.offset < 0 || target.offset > markdown.length
        || targetTo < target.offset || targetTo > markdown.length) return undefined;

    const block = markdown.slice(source.offset, sourceTo);
    const withoutSource = markdown.slice(0, source.offset) + markdown.slice(sourceTo);
    const insertionPosition = isOutlineEmptyParentTarget(outline, sourceIndex, targetIndex) ? 'after' : position;
    const originalInsertion = insertionPosition === 'before' ? target.offset : targetTo;
    const insertion = originalInsertion - (source.offset < originalInsertion ? sourceTo - source.offset : 0);
    if (insertion < 0 || insertion > withoutSource.length) return undefined;
    if (insertion === source.offset) return undefined;

    const before = withoutSource.slice(0, insertion);
    const after = withoutSource.slice(insertion);
    const lineSeparator = getMarkdownLineSeparator(markdown);
    const separatorBefore = before && !endsWithLineBreak(before) ? lineSeparator : '';
    const separatorAfter = after && !endsWithLineBreak(block) ? lineSeparator : '';
    return before + separatorBefore + block + separatorAfter + after;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param outline - Markdownの位置・寸法・件数・時間を表す数値。
 * @param index - 配列・行列・文字列の要素位置を示す番号。
 * @returns Markdownで利用する数値。
 */
function findOutlineSectionEnd(markdown: string, outline: readonly OutlineItem[], index: number): number {
    const source = outline[index];
    if (!source) return -1;
    for (let candidate = index + 1; candidate < outline.length; candidate += 1) {
        if (outline[candidate].level <= source.level) return outline[candidate].offset;
    }
    return markdown.length;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownで利用する文字列。
 */
function getMarkdownLineSeparator(markdown: string): string {
    const match = /\r\n|\r|\n/.exec(markdown);
    return match?.[0] ?? '\n';
}

/**
 * Markdownのends・with・line・breakを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 条件が成立したかを示す真偽値。
 */
function endsWithLineBreak(value: string): boolean {
    return /(?:\r\n|\r|\n)$/.test(value);
}

/**
 * Markdownのsplit・markdown・blocksを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownに対応する要素の一覧。
 */
export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
    // 改行を正規化したMarkdownをmarkedで解析し、元文書のオフセットを持つブロックへ変換する。
    if (!markdown) return [{ from: 0, to: 0, raw: '', type: 'space' }];
    const { normalized, originalOffsets } = normalizeWithOriginalOffsets(markdown);
    const tokens = marked.lexer(normalized, { gfm: true, breaks: false });
    const blocks: MarkdownBlock[] = [];
    let cursor = 0;
    for (const token of tokens) {
        // トークンの前にある未分類部分を空白ブロックとして追加する。
        const raw = token.raw ?? '';
        const found = normalized.indexOf(raw, cursor);
        if (found > cursor) {
            const from = originalOffsets[cursor];
            const to = originalOffsets[found];
            blocks.push({ from, to, raw: markdown.slice(from, to), type: 'space' });
        }
        const from = found >= 0 ? found : cursor;
        const to = from + raw.length;
        const originalFrom = originalOffsets[from];
        const originalTo = originalOffsets[to];
        blocks.push({
            from: originalFrom,
            to: originalTo,
            raw: markdown.slice(originalFrom, originalTo),
            type: token.type
        });
        cursor = to;
    }
    if (cursor < normalized.length) {
        // 最後のトークン以降に残った文字列をテキストブロックとして追加する。
        const originalFrom = originalOffsets[cursor];
        blocks.push({ from: originalFrom, to: markdown.length, raw: markdown.slice(originalFrom), type: 'text' });
    }
    return blocks.length ? blocks : [{ from: 0, to: markdown.length, raw: markdown, type: 'text' }];
}

/**
 * Markdownの入力を許可された形式へ整える。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownで生成または変換した値。
 */
function normalizeWithOriginalOffsets(markdown: string): {
    /**
     * Markdownで扱うnormalizedの文字列。
     */
    normalized: string;
    /**
     * Markdownのoriginal・offsetsを表す数値。
     */
    originalOffsets: number[]
} {
    // CRLF・CRをLFへ統一し、正規化後の各文字位置から元文書位置への対応表を作る。
    let normalized = '';
    const originalOffsets = [0];
    let offset = 0;
    while (offset < markdown.length) {
        if (markdown[offset] === '\r') {
            offset += markdown[offset + 1] === '\n' ? 2 : 1;
            normalized += '\n';
        } else {
            normalized += markdown[offset];
            offset += 1;
        }
        originalOffsets.push(offset);
    }
    return { normalized, originalOffsets };
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param language - Markdownの対象や分岐を識別する値。
 * @returns Markdownに対応する要素の一覧。
 */
export function collectDiagnostics(markdown: string, language: SupportedLanguage | string = 'ja'): Diagnostic[] {
    // 文書全体を1回走査し、診断パネルとPDF出力前チェックが共有する結果を作る。
    const messages = getMessages(language);
    const diagnostics: Diagnostic[] = [];
    const lines = markdown.split(/\r\n|\r|\n/);
    const fencedLines = new Set<number>();
    let openFence: {
        /**
         * Markdownで扱うmarkerの文字列。
         */
        marker: string;
        /**
         * Markdownの位置・寸法・件数・時間を表す数値。
         */
        line: number
    } | undefined;

    lines.forEach(
        /**
         * lineごとにexecを実行する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(stripResourceContainerPrefix(line));
            if (!openFence && !match) return;
            fencedLines.add(index + 1);
            if (!match) return;
            if (!openFence) {
                openFence = { marker: match[1], line: index + 1 };
                return;
            }
            if (match[1][0] === openFence.marker[0]
                && match[1].length >= openFence.marker.length
                && /^[ \t]*$/.test(match[2])) {
                openFence = undefined;
            }
        });
    if (openFence) {
        diagnostics.push({
            severity: 'error',
            code: 'unclosed-fence',
            line: openFence.line,
            message: messages.diagnostics.unclosedFence(openFence.marker)
        });
    }

    const seen = new Map<string, number>();
    lines.forEach(
        /**
         * lineごとにifを実行する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            if (fencedLines.has(index + 1)) return;
            const match = /^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?\s*#*\s*$/.exec(line);
            if (!match) return;
            const visible = stripMveTextColorMarkup(match[2]);
            const explicit = /\s+\{#([^}]+)\}\s*$/.exec(visible);
            const id = explicit?.[1] || match[3] || slugify(
                visible
                    .replace(/\s+\{#[^}]+\}\s*$/, '')
                    .replace(/[*_`~+=]/g, '')
                    .trim()
            );
            const count = seen.get(id) ?? 0;
            if (count) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'duplicate-heading',
                    line: index + 1,
                    message: messages.diagnostics.duplicateHeading(id)
                });
            }
            seen.set(id, count + 1);
        });

    const recognizedTableLines = new Set<number>();
    for (let index = 0; index < lines.length - 1; index += 1) {
        if (fencedLines.has(index + 1) || recognizedTableLines.has(index + 1) || !isTableRowLine(lines[index])) continue;
        const next = lines[index + 1];
        if (isTableSeparatorLine(next)) {
            diagnoseMarkdownTable(lines, index, fencedLines, diagnostics, messages);
            recognizedTableLines.add(index + 1);
            recognizedTableLines.add(index + 2);
            for (let rowIndex = index + 2; rowIndex < lines.length && isTableRowLine(lines[rowIndex]); rowIndex += 1) {
                recognizedTableLines.add(rowIndex + 1);
            }
        } else if (isInvalidTableSeparatorCandidate(next)) {
            diagnostics.push({
                severity: 'error',
                code: 'invalid-table-separator',
                line: index + 2,
                message: messages.diagnostics.invalidTableSeparator
            });
            recognizedTableLines.add(index + 1);
            recognizedTableLines.add(index + 2);
            for (let rowIndex = index + 2; rowIndex < lines.length && isTableRowLine(lines[rowIndex]); rowIndex += 1) {
                recognizedTableLines.add(rowIndex + 1);
            }
        }
    }

    const referenceDefinitions = new Set<string>();
    lines.forEach(
        /**
         * lineごとにifを実行する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            if (fencedLines.has(index + 1)) return;
            const definition = parseReferenceDefinition(line);
            if (definition) referenceDefinitions.add(normalizeReferenceLabel(definition));
        });
    lines.forEach(
        /**
         * lineごとにifを実行する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            if (fencedLines.has(index + 1)) return;
            if (parseReferenceDefinition(line)) return;
            const sourceLine = maskInlineCode(line);
            for (const reference of collectReferenceUsages(sourceLine)) {
                if (reference.isImage && !reference.text.trim()) {
                    diagnostics.push({
                        severity: 'warning',
                        code: 'empty-image-alt',
                        line: index + 1,
                        message: messages.diagnostics.emptyImageAlt
                    });
                }
                reportBrokenReference(reference.label || reference.text, index + 1, referenceDefinitions, diagnostics, messages);
            }
        });

    const imageSource = markdown.replace(/`+[^`\r\n]*`+/g,
        /**
         * コードをreplaceへ渡し、Markdownの結果または副作用を処理する。
         * @param code - Markdownへ渡す入力。
         * @returns Markdownに対応する要素の一覧。
         */
        (code) => code.replace(/[^\r\n]/g, ' '));
    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let imageMatch: RegExpExecArray | null;
    while ((imageMatch = imagePattern.exec(imageSource))) {
        const line = markdown.slice(0, imageMatch.index).split(/\r\n|\r|\n/).length;
        if (fencedLines.has(line)) continue;
        if (!imageMatch[1].trim()) {
            diagnostics.push({
                severity: 'warning',
                code: 'empty-image-alt',
                line,
                message: messages.diagnostics.emptyImageAlt
            });
        }
        if (/^(?:https?:|data:|#)/i.test(imageMatch[2])) continue;
        diagnostics.push({
            severity: 'info',
            code: 'local-image',
            line,
            source: imageMatch[2],
            message: messages.diagnostics.localImageCheck(imageMatch[2])
        });
    }
    return sortDiagnostics(diagnostics);
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownに対応する要素の一覧。
 */
export function collectLocalResourceReferences(markdown: string): LocalResourceReference[] {
    const lines = markdown.split(/\r\n|\r|\n/);
    const fencedLines = new Set<number>();
    let openFence: {
        /**
         * Markdownで扱うmarkerの文字列。
         */
        marker: string;
        /**
         * Markdownの位置・寸法・件数・時間を表す数値。
         */
        line: number
    } | undefined;
    lines.forEach(
        /**
         * lineごとにexecを実行する。
         * @param line - lineのsを参照する走査対象。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(stripResourceContainerPrefix(line));
            if (!openFence && !match) return;
            fencedLines.add(index + 1);
            if (!match) return;
            if (!openFence) {
                openFence = { marker: match[1], line: index + 1 };
                return;
            }
            if (match[1][0] === openFence.marker[0]
                && match[1].length >= openFence.marker.length
                && /^[ \t]*$/.test(match[2])) {
                openFence = undefined;
            }
        });

    const commentState = { open: false };
    const scanLines = lines.map(
        /**
         * 各lineからlengthを取り出して一覧化する。
         * @param line - lineのlengthを参照する走査対象。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns lengthを取り出した変換結果の一覧。
         */
        (line, index) => {
            if (fencedLines.has(index + 1) || isIndentedResourceCodeLine(line)) return ' '.repeat(line.length);
            return maskHtmlComments(maskInlineCode(line), commentState);
        });
    const scanSource = scanLines.join('\n');
    const definitions = new Map<string, LocalResourceDefinition>();
    const definitionLines = new Set<number>();
    scanLines.forEach(
        /**
         * lineごとにparse・local・resource・definitionを実行する。
         * @param line - Markdownの位置・寸法・件数・時間を表す数値。
         * @param index - 配列・行列・文字列の要素位置を示す番号。
         * @returns 副作用を完了し、値は返さない。
         */
        (line, index) => {
            const definition = parseLocalResourceDefinition(line);
            if (!definition || !isLocalResourceSource(definition.source)) return;
            definitionLines.add(index + 1);
            definitions.set(normalizeReferenceLabel(definition.label), {
                kind: definition.kind,
                source: definition.source,
                line: index + 1
            });
        });

    const references: LocalResourceReference[] = [];
    const usedDefinitions = new Set<string>();
    for (const scanned of scanMarkdownResourceLinks(scanSource)) {
        const line = lineNumberAt(scanSource, scanned.offset);
        if (definitionLines.has(line)) continue;
        if (scanned.source) {
            if (isLocalResourceSource(scanned.source)) {
                references.push({ kind: scanned.kind, source: scanned.source, line });
            }
            continue;
        }
        const label = normalizeReferenceLabel(scanned.referenceLabel ?? '');
        const definition = definitions.get(label);
        if (!definition) continue;
        usedDefinitions.add(label);
        references.push({
            kind: scanned.kind === 'image' || definition.kind === 'image' ? 'image' : 'link',
            source: definition.source,
            line
        });
    }

    // 参照定義が単独で書かれている場合も、定義行自体を検査対象にする。
    definitions.forEach(
        /**
         * definitionごとにifを実行する。
         * @param definition - definitionのkindを参照する走査対象。
         * @param label - 画面または検証結果に表示する説明文。
         * @returns 副作用を完了し、値は返さない。
         */
        (definition, label) => {
            if (!usedDefinitions.has(label)) {
                references.push({ kind: definition.kind, source: definition.source, line: definition.line });
            }
        });
    return references;
}

/**
 * Markdownの入力を走査し、該当する範囲または要素を順に返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns Markdownに対応する要素の一覧。
 */
function scanMarkdownResourceLinks(source: string): ScannedResourceLink[] {
    const links: ScannedResourceLink[] = [];
    for (let index = 0; index < source.length; index += 1) {
        const isImage = source[index] === '!' && source[index + 1] === '[';
        const open = isImage ? index + 1 : index;
        if (source[open] !== '['
            || source[open - 1] === '\\'
            || (source[open - 1] === '!' && source[open - 2] === '\\')
            || (isImage && source[index - 1] === '\\')) continue;
        const text = readBracketContent(source, open);
        if (!text) continue;
        const kind = isImage ? 'image' : 'link';
        const afterText = text.end + 1;
        if (source[afterText] === '(') {
            const destination = readInlineResourceDestination(source, afterText);
            if (destination) {
                links.push({ kind, source: destination.source, offset: index });
                index = destination.end;
                continue;
            }
        }
        if (source[afterText] === '[') {
            const label = readBracketContent(source, afterText);
            if (label) {
                links.push({
                    kind,
                    referenceLabel: label.content || text.content,
                    offset: index
                });
                index = label.end;
                continue;
            }
        }
        // 定義済みのショートカット参照は、定義マップで解決できるものだけ後段で採用する。
        links.push({ kind, referenceLabel: text.content, offset: index });
        index = text.end;
    }
    const htmlPattern = /<(img|a)\b[^>]*?\b(src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu;
    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlPattern.exec(source))) {
        const htmlSource = htmlMatch[3] ?? htmlMatch[4] ?? htmlMatch[5] ?? '';
        links.push({
            kind: htmlMatch[1].toLowerCase() === 'img' ? 'image' : 'link',
            source: htmlSource,
            offset: htmlMatch.index
        });
    }
    return links.sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.offset - right.offset);
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param open - Markdownで扱う数値。
 * @returns Markdownのread・inline・resource・destinationが生成する結果。
 */
function readInlineResourceDestination(source: string, open: number): {
    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string;
    /**
     * Markdownのendを表す数値。
     */
    end: number
} | undefined {
    let index = open + 1;
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (index >= source.length) return undefined;

    let destination: string;
    if (source[index] === '<') {
        const start = ++index;
        while (index < source.length) {
            if (source[index] === '\\') {
                index += 2;
                continue;
            }
            if (source[index] === '>') break;
            index += 1;
        }
        if (source[index] !== '>') return undefined;
        destination = source.slice(start, index);
        index += 1;
    } else {
        const start = index;
        let nestedParentheses = 0;
        while (index < source.length) {
            const character = source[index];
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === '(') {
                nestedParentheses += 1;
                index += 1;
                continue;
            }
            if (character === ')') {
                if (nestedParentheses === 0) break;
                nestedParentheses -= 1;
                index += 1;
                continue;
            }
            if (/\s/u.test(character) && nestedParentheses === 0) break;
            index += 1;
        }
        destination = source.slice(start, index);
    }
    if (!destination) return undefined;
    const close = findInlineResourceClose(source, index);
    return close < 0 ? undefined : { source: destination.replace(/\\([\\()])/g, '$1'), end: close };
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param start - Markdownで扱う数値。
 * @returns Markdownで利用する数値。
 */
function findInlineResourceClose(source: string, start: number): number {
    let nestedParentheses = 0;
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '\\') {
            index += 1;
            continue;
        }
        if (source[index] === '(') nestedParentheses += 1;
        if (source[index] !== ')') continue;
        if (nestedParentheses === 0) return index;
        nestedParentheses -= 1;
    }
    return -1;
}

/**
 * Markdownの入力を構造化した値へ変換する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで生成または変換した値。
 */
function parseLocalResourceDefinition(line: string): {
    /**
     * メッセージ、項目、または処理の種類を識別する値。
     */
    kind: 'image' | 'link';
    /**
     * 画面または検証結果に表示する説明文。
     */
    label: string;
    /**
     * 解析・描画・変換の起点となる本文。
     */
    source: string
} | undefined {
    const candidate = stripResourceContainerPrefix(line);
    const match = /^(!?)\[([^\]]*)\]:\s*(<[^>\r\n]+>|[^\s]+)(?:\s+.*)?$/u.exec(candidate);
    if (!match || match[2].startsWith('^')) return undefined;
    return {
        kind: match[1] ? 'image' : 'link',
        label: match[2],
        source: match[3].replace(/^<|>$/g, '').trim()
    };
}

/**
 * Markdownの条件を判定する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isIndentedResourceCodeLine(line: string): boolean {
    if (/^(?: {4}|\t)/u.test(line)) return true;
    if (/^\s{0,3}(?:>|(?:[-+*]|\d+[.)]))\s+ {4}/u.test(line)) return true;
    const stripped = stripResourceContainerPrefix(line);
    return stripped !== line && /^(?: {4}|\t)/u.test(stripped);
}

/**
 * Markdownから不要または危険な情報を除去する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する文字列。
 */
function stripResourceContainerPrefix(line: string): string {
    if (/^(?: {4}|\t)/u.test(line)) return line;
    let result = line;
    for (let count = 0; count < 4; count += 1) {
        const next = result
            .replace(/^\s{0,3}>\s?/u, '')
            .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/u, '');
        if (next === result) break;
        result = next;
    }
    return result.replace(/^\s+/u, '');
}

/**
 * Markdownのmask・html・commentsを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @param state - 現在の編集・表示状態。
 * @returns Markdownで利用する文字列。
 */
function maskHtmlComments(line: string, state: {
    /**
     * Markdownのopenを切り替えるフラグ。
     */
    open: boolean
}): string {
    let result = '';
    let offset = 0;
    while (offset < line.length) {
        if (state.open) {
            const close = line.indexOf('-->', offset);
            if (close < 0) return `${result}${' '.repeat(line.length - offset)}`;
            result += ' '.repeat(close + 3 - offset);
            offset = close + 3;
            state.open = false;
            continue;
        }
        const open = line.indexOf('<!--', offset);
        if (open < 0) return result + line.slice(offset);
        result += line.slice(offset, open);
        result += ' '.repeat(4);
        offset = open + 4;
        state.open = true;
    }
    return result;
}

/**
 * Markdownのline・number・atを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function lineNumberAt(source: string, offset: number): number {
    let line = 1;
    for (let index = 0; index < offset; index += 1) {
        if (source[index] === '\n') line += 1;
    }
    return line;
}

/**
 * Markdownの要素を規則に従って並べ替える。
 * @param diagnostics - Markdownへ渡す要素の一覧。
 * @returns Markdownに対応する要素の一覧。
 */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics
        .map(
            /**
             * 各項目を変換して一覧化する。
             * @param item - 走査中の要素。
             * @param index - 配列・行列・文字列の要素位置を示す番号。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            (item, index) => ({ item, index }))
        .sort(
            /**
             * 行または配列位置を比較して並び順を決める。
             * @param left - 比較対象の左側の値。
             * @param right - 比較対象の右側の値。
             * @returns 2つの要素の順序を示す数値。
             */
            (left, right) => {
                const leftLine = left.item.line ?? Number.MAX_SAFE_INTEGER;
                const rightLine = right.item.line ?? Number.MAX_SAFE_INTEGER;
                return leftLine - rightLine || left.index - right.index;
            })
        .map(
            /**
             * 各設定を変換して一覧化する。
             * @param options - 呼び出し側が指定する処理設定。
             * @returns 入力要素から生成した変換結果の一覧。
             */
            ({ item }) => item);
}

/**
 * Markdownのsummarize・diagnosticsを処理し、呼び出し側へ結果または副作用を返す。
 * @param diagnostics - Markdownへ渡す要素の一覧。
 * @returns Markdownのsummarize・diagnosticsが生成する結果。
 */
export function summarizeDiagnostics(diagnostics: Diagnostic[]): DiagnosticSummary {
    return {
        errors: diagnostics.filter(
            /**
             * 種別「error」の項目だけを残す。
             * @param item - 項目のseverityを参照する走査対象。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (item) => item.severity === 'error'),
        warnings: diagnostics.filter(
            /**
             * 種別「warning」の項目だけを残す。
             * @param item - 項目のseverityを参照する走査対象。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (item) => item.severity === 'warning'),
        infos: diagnostics.filter(
            /**
             * 種別「info」の項目だけを残す。
             * @param item - 項目のseverityを参照する走査対象。
             * @returns 条件を満たした要素だけを含む一覧。
             */
            (item) => item.severity === 'info')
    };
}

/**
 * Markdownのdiagnose・markdown・tableを処理し、呼び出し側へ結果または副作用を返す。
 * @param lines - Markdownの位置・寸法・件数・時間を表す数値。
 * @param headerLine - Markdownの位置・寸法・件数・時間を表す数値。
 * @param fencedLines - Markdownの位置・寸法・件数・時間を表す数値。
 * @param diagnostics - Markdownへ渡す要素の一覧。
 * @param messages - Markdownで扱う文字列または本文。
 * @returns 条件が成立したかを示す真偽値。
 */
function diagnoseMarkdownTable(lines: string[], headerLine: number, fencedLines: Set<number>, diagnostics: Diagnostic[], messages: ReturnType<typeof getMessages>): void {
    const header = splitTableCells(lines[headerLine]);
    const separator = splitTableCells(lines[headerLine + 1]);
    if (header.some(
        /**
         * セルをtrimへ渡し、Markdownの結果または副作用を処理する。
         * @param cell - Markdownで走査または更新する要素。
         * @returns 条件が成立したかを示す真偽値。
         */
        (cell) => !cell.trim())) {
        diagnostics.push({
            severity: 'warning',
            code: 'empty-table-header',
            line: headerLine + 1,
            message: messages.diagnostics.emptyTableHeader
        });
    }
    if (header.length !== separator.length) {
        diagnostics.push({
            severity: 'error',
            code: 'table-column-mismatch',
            line: headerLine + 2,
            message: messages.diagnostics.tableColumnMismatch(header.length, separator.length, 'separator')
        });
    }
    for (let index = headerLine + 2; index < lines.length && isTableRowLine(lines[index]); index += 1) {
        if (fencedLines.has(index + 1)) break;
        const row = splitTableCells(lines[index]);
        if (row.length !== header.length) {
            diagnostics.push({
                severity: 'error',
                code: 'table-column-mismatch',
                line: index + 1,
                message: messages.diagnostics.tableColumnMismatch(header.length, row.length, 'body')
            });
        }
    }
}

/**
 * Markdownの条件を判定する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 条件が成立したかを示す真偽値。
 */
function isLikelyTableSeparatorLine(line: string): boolean {
    const cells = splitTableCells(line);
    return cells.length > 0 && cells.some(
        /**
         * セルをtestへ渡し、Markdownの結果または副作用を処理する。
         * @param cell - Markdownで走査または更新する要素。
         * @returns 条件が成立したかを示す真偽値。
         */
        (cell) => /^:?-{1,}:?$/.test(cell.trim())) && line.includes('|');
}

/**
 * Markdownの条件を判定する。
 * @param separator - Markdownで受け渡す文字列。
 * @returns 条件が成立したかを示す真偽値。
 */
function isInvalidTableSeparatorCandidate(separator: string): boolean {
    const cells = splitTableCells(separator);


    const separatorLike = /**
     * Markdownのseparator・likeを処理し、呼び出し側へ結果または副作用を返す。
     * @param cell - Markdownで走査または更新する要素。
     * @returns 条件が成立したかを示す真偽値。
     */ (cell: string): boolean => !cell.trim() || /^:?-{1,}:?$/.test(cell.trim());
    return isLikelyTableSeparatorLine(separator) && cells.every(separatorLike);
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
interface BracketContent {

    /**
     * Markdownで解析・表示・保存する本文。
     */
    content: string;

    /**
     * Markdownのendを表す数値。
     */
    end: number;
}

/**
 * Markdownで共有するデータ形状を表すインターフェース。
 */
interface ReferenceUsage {

    /**
     * Markdownの状態を示すフラグ。
     */
    isImage: boolean;

    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: string;

    /**
     * 画面または検証結果に表示する説明文。
     */
    label: string;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param open - Markdownで扱う数値。
 * @returns 副作用を完了し、値は返さない。
 */
function readBracketContent(source: string, open: number): BracketContent | undefined {
    let depth = 0;
    let content = '';
    for (let index = open + 1; index < source.length; index += 1) {
        const character = source[index];
        if (character === '\\' && index + 1 < source.length) {
            content += character + source[index + 1];
            index += 1;
            continue;
        }
        if (character === '[') {
            depth += 1;
            content += character;
            continue;
        }
        if (character === ']') {
            if (depth === 0) return { content, end: index };
            depth -= 1;
            content += character;
            continue;
        }
        content += character;
    }
    return undefined;
}

/**
 * Markdownから必要な値またはリソースを取得する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownに対応する要素の一覧。
 */
function collectReferenceUsages(line: string): ReferenceUsage[] {
    const usages: ReferenceUsage[] = [];
    for (let index = 0; index < line.length; index += 1) {
        const isImage = line[index] === '!' && line[index + 1] === '[';
        const open = isImage ? index + 1 : index;
        if (line[open] !== '[' || (open > 0 && line[open - 1] === '\\')) continue;
        const text = readBracketContent(line, open);
        if (!text) continue;
        const labelOpen = text.end + 1;
        if (line[labelOpen] !== '[') {
            index = text.end;
            continue;
        }
        const label = readBracketContent(line, labelOpen);
        if (!label) {
            index = text.end;
            continue;
        }
        usages.push({ isImage, text: text.content, label: label.content });
        index = label.end;
    }
    return usages;
}

/**
 * Markdownの入力を構造化した値へ変換する。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns 副作用を完了し、値は返さない。
 */
function parseReferenceDefinition(line: string): string | undefined {
    const open = line.search(/\S/);
    if (open < 0 || line[open] !== '[') return undefined;
    const label = readBracketContent(line, open);
    if (!label || !/^\s*:/.test(line.slice(label.end + 1))) return undefined;
    const destination = line.slice(label.end + 1).replace(/^\s*:\s*/, '');
    if (!/^(?:<[^>\r\n]+>|\S+)/.test(destination)) return undefined;
    return label.content;
}

/**
 * Markdownのmask・inline・codeを処理し、呼び出し側へ結果または副作用を返す。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する文字列。
 */
function maskInlineCode(line: string): string {
    return line.replace(/`+[^`\r\n]*`+/g,
        /**
         * Markdownの前提条件を準備し、回帰条件を検証するテストケース。
         * @param code - テスト本体を実行するコールバック。
         * @returns テストケースを実行し、値は返さない。
         */
        (code) => code.replace(/[^\r\n]/g, ' '));
}

/**
 * Markdownのreport・broken・referenceを処理し、呼び出し側へ結果または副作用を返す。
 * @param label - 画面または検証結果に表示する説明文。
 * @param line - Markdownの位置・寸法・件数・時間を表す数値。
 * @param definitions - Markdownで受け渡す文字列。
 * @param diagnostics - Markdownへ渡す要素の一覧。
 * @param messages - Markdownで扱う文字列または本文。
 * @returns 副作用を完了し、値は返さない。
 */
function reportBrokenReference(
    label: string,
    line: number,
    definitions: Set<string>,
    diagnostics: Diagnostic[],
    messages: ReturnType<typeof getMessages>
): void {
    const normalizedLabel = normalizeReferenceLabel(label);
    if (!normalizedLabel) return;
    if (definitions.has(normalizedLabel)) return;
    diagnostics.push({
        severity: 'warning',
        code: 'broken-reference-link',
        line,
        message: messages.diagnostics.missingReference(normalizedLabel)
    });
}

/**
 * Markdownの入力を許可された形式へ整える。
 * @param label - 画面または検証結果に表示する説明文。
 * @returns Markdownで利用する文字列。
 */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\\([\\\[\]])/g, '$1').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Markdownの条件を判定する。
 * @param source - 解析・描画・変換の起点となる本文。
 * @returns 条件が成立したかを示す真偽値。
 */
function isLocalResourceSource(source: string): boolean {
    if (!source || /^#/u.test(source)) return false;
    if (/^[A-Za-z]:[\\/]/u.test(source)) return true;
    if (/^(?:\\\\|\/\/)/u.test(source)) return true;
    if (/^file:/i.test(source)) return true;
    return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source);
}

/**
 * Markdownを出力または保存できる文字列へ整える。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownで利用する文字列。
 */
export function formatMarkdown(markdown: string): string {
    // 改行形式を保ったまま過剰な空行を縮約し、末尾に改行を付ける。
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    // 行末空白はMarkdownのハードブレークやユーザー入力の一部なので変更しない。
    const normalized = markdown
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(
            /**
             * 各lineからsliceを取り出して一覧化する。
             * @param line - lineのsliceを参照する走査対象。
             * @returns sliceを取り出した変換結果の一覧。
             */
            (line) => {
                const trailing = /[\t ]+$/.exec(line)?.[0] ?? '';
                return /^ {2,}$/.test(trailing) ? line : line.slice(0, line.length - trailing.length);
            })
        .join('\n')
        .replace(/\n{4,}/g, '\n\n\n');
    const finalText = normalized.length && !normalized.endsWith('\n') ? normalized + '\n' : normalized;
    return eol === '\r\n' ? finalText.replace(/\n/g, '\r\n') : finalText;
}

/**
 * Markdownのword・statsを処理し、呼び出し側へ結果または副作用を返す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns Markdownのword・statsが生成する結果。
 */
export function wordStats(markdown: string): {
    /**
     * 解析・編集・変換の対象となるMarkdown本文。
     */
    markdown: number;
    /**
     * 表示・解析・変換の対象となる本文。
     */
    text: number;
    /**
     * Markdownで扱うlinesの一覧。
     */
    lines: number
} {
    // コードやMarkdown記号を除いた本文を作り、文字数と行数を数える。
    const text = stripMveTextColorMarkup(markdown)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
        .replace(/[*_`~+=#>|-]/g, '')
        .trim();
    return {
        markdown: markdown.length,
        text: Array.from(text).length,
        lines: markdown ? markdown.split(/\r?\n/).length : 1
    };
}

/**
 * Markdownのslugifyを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns Markdownで利用する文字列。
 */
export function slugify(value: string): string {
    // 見出し文字列を小文字化し、使用可能な文字とハイフンだけのIDへ変換する。
    return value
        .trim()
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-') || 'section';
}

/**
 * Markdownのline・startを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function lineStart(source: string, offset: number): number {
    // 指定位置を含む行の開始オフセットを返す。
    return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

/**
 * Markdownのline・endを処理し、呼び出し側へ結果または副作用を返す。
 * @param source - 解析・描画・変換の起点となる本文。
 * @param offset - Markdownの位置・寸法・件数・時間を表す数値。
 * @returns Markdownで利用する数値。
 */
function lineEnd(source: string, offset: number): number {
    // 指定位置を含む行の終端オフセットを返す。
    const end = source.indexOf('\n', offset);
    return end < 0 ? source.length : end;
}
