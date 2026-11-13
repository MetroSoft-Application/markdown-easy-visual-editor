/**
 * @fileoverview 文書全体をTextile↔Markdownへ変換する。変換は止めず、プレビューの比較で変換の誤りを検出して直す。
 * 実行境界: Webview（変換タブ）とtest（Node）。描画は呼び出し側から渡された関数（Webviewでは描画Worker）で行う。
 * 方針:
 * - ブロックごとに、構文の意味が同じ変換先の記法へ書き換える（候補は{@link buildCandidates}）。HTMLへは変換しない。
 *   原文が生HTMLで書かれた部分だけは、原文のHTMLのまま残すか、同じ意味の記法へ戻す。
 * - 逆変換では、順変換の規則の逆（逆変換モード）を先に試し、元の記法へ戻す。原文の記録は持たない。
 * - 変換先に同じ意味の記法がないもの（Markdownの図・数式・タスクリスト、Textileの定義リスト・略語・class付き段落など）は、
 *   意味を表す変換先の記法（言語名付きのコードブロックなど）か、元の記法の文字のまま書く。Markdown文書のプレビューは
 *   Textileの記法も描画するため、Textileの記法のまま書いた部分はMarkdownでも同じ意味で表示される。
 * - 組み立てた文書を描画し直して変換前と比べ（previewEquivalence。表示上の装飾の違いと、同じ意味の書き方の違いは同一視する）、
 *   違いが出たブロックを次の候補へ切り替える。比較は変換の誤りを見つけるためのもので、一致しない場合も変換結果を返し、
 *   `equal`をfalseにする（呼び出し側は変換を適用したうえで、見た目が変わり得ることを通知する）。
 * - 文書先頭のYAML front matterは、Textileでは表示されないコメント（`###.`）として書き、比較の対象から外す。
 * 不変条件: 中止（`cancelled`）以外は必ず変換結果を返す。変換結果に、原文にないHTMLを書き出さない。
 */
import { htmlToMarkdown, htmlToTextile } from '../../shared/embeddedHtml';
import { collectLinkReferences, convertDocumentSyntax, type DocumentConversionOptions, type DocumentSyntax } from '../../shared/formatConversion';
import type { MarkdownRenderFormat } from './markdownRendererCore';
import { hasMixedTextileSyntaxCandidate } from './mixedTextileSyntax';
import { comparePreviewBlocks } from './previewEquivalence';

/**
 * 文書を指定形式で描画し、サニタイズ前のブロック一覧を返す関数。
 */
export type PreviewBlockRenderer = (
    text: string,
    format: MarkdownRenderFormat
) => Promise<ReadonlyArray<{ html: string }>>;

/**
 * 変換の結果。
 */
export interface PreservingConversionResult {
    /** 変換後の文書。`cancelled`がtrueの場合だけ適用しない（その場合は原文が入る）。 */
    text: string;
    /** 変換前後のプレビューが同じ意味になった場合にtrue。falseでも適用し、見た目が変わり得ることを利用者へ知らせる。 */
    equal: boolean;
    /** 本文の変更などで変換を打ち切った場合にtrue。 */
    cancelled: boolean;
    /** `equal`がfalseの場合に、違いが残った変換前の位置（UTF-16）。 */
    firstDifferenceOffset?: number;
}

/**
 * 原文上の変換単位。描画器のブロック1つ、または描画されない原文（脚注定義・参照リンクの定義など）。
 */
interface ConversionUnit {
    /** 原文での開始位置。 */
    from: number;
    /** 原文での終了位置（含まない）。 */
    to: number;
    /** 変換前のプレビューでの描画HTML（ラッパーを除く）。描画されない原文は空文字。 */
    html: string;
    /** 描画されない原文ならtrue。 */
    hidden: boolean;
}

/**
 * 1回の変換で描画を比べ直す上限。違いの出たブロックを1つずつ次の候補へ切り替えるため、ブロック数を上限にしつつ、
 * 巨大な文書で描画を繰り返し過ぎないよう打ち切る。打ち切った場合は、ブロックごとに選んだ候補で組み立てた結果を返す。
 */
const MAX_VERIFY_ROUNDS = 60;

/**
 * 候補を使い切ったブロックで違いが残ったときに、直前のブロックへ遡って候補を切り替える回数の上限。
 * 描画器同士の違いで一致させられない文書では遡りが続くため、少ない回数で打ち切る。
 */
const MAX_STEPS_BACK = 3;

/**
 * Markdown文書の先頭のYAML front matter（`---`の行で囲んだ範囲と、直後の改行1つ）。
 */
const FRONT_MATTER = /^---[ \t]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---[ \t]*(?:\r\n|\r|\n|$)/;

/**
 * 順変換がfront matterを書いたTextileのコメント（`###. ---`〜`---`。空行を含む場合は`###..`と、閉じるための空の段落`p. `）。
 * 1: front matterの本文（`---`から`---`まで）。
 */
const FRONT_MATTER_COMMENT = /^###\.(?:\.)? (---[ \t]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---[ \t]*)(?:(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)p\. [ \t]*)?(?:\r\n|\r|\n|$)/;

/**
 * 文字列が空行で終わるか（改行が2つ以上続いて終わるか）を判定する。CRLFは1つの改行として数える
 * （`\r`と`\n`を別々の改行と数えると、1つのCRLFだけで空行とみなし、ブロックの間の空行を補わなくなる）。
 */
const ENDS_WITH_BLANK_LINE = /(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n)[ \t]*$/;

/** Textileのブロック署名（`p.`・`h1.`・`bc..`・`fn1.`・`###.`など）で始まる文字列。 */
const TEXTILE_SIGNATURE_START = /^(?:p|div|bq|bc|pre|notextile|h[1-6]|fn\d+|table|###)(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|[<>=()])*\.\.?(?:\s|$)/;

/** Textileの複数段落ブロック（`bc..`・`bq..`・`###..`など、次の署名まで続くブロック）で始まる文字列。 */
const TEXTILE_EXTENDED_START = /^(?:p|div|bq|bc|pre|notextile|###)(?:\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|[<>=()])*\.\.(?:\s|$)/;

/**
 * Textileの段落として読まれる文字列か（署名・リスト・表・生HTML・定義リスト・水平線で始まらないか）を判定する。
 * 複数段落ブロックの後ろでは、段落なら先頭に`p.`を付けて閉じ、段落以外なら前に空の段落を置いて閉じる。
 */
const TEXTILE_NON_PARAGRAPH_START = /^\s*(?:[*#]+\s|\||<|-\s|---)/;

/**
 * Markdownの段落以外のブロック（リスト・見出し・引用・コード・表・生HTML・水平線）で始まる文字列。
 * Markdownへの変換で原文のまま残したTextileの複数段落ブロックの後ろでは、段落なら先頭に`p.`を付け（Markdown文書の
 * プレビューはTextileの段落として描画する）、段落以外なら前に空の段落`p. `を置いて閉じる。
 */
const MARKDOWN_NON_PARAGRAPH_START = /^\s*(?:[*+-]\s|\d+[.)]\s|#{1,6}\s|>|`{3}|~{3}|\||<|\[\^|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

/**
 * ブロックの描画HTMLから、ソース位置のラッパーと原文の範囲を取り出す。
 * @param html - 描画器が返したブロックHTML。
 * @returns 範囲と中身。`footnoteList`はMarkdownの描画器が文書末尾に出す脚注一覧（外枠が`<section>`）ならtrue。
 * 範囲を持たないブロックはundefined。
 */
function readBlock(html: string): { from: number; to: number; inner: string; footnoteList: boolean } | undefined {
    const match = /^\s*<(div|section) class="([^"]*\b)?markdown-source-block\b[^"]*" data-source-from="(\d+)" data-source-to="(\d+)">([\s\S]*)<\/\1>\s*$/.exec(html);
    if (!match) return undefined;
    return { from: Number(match[3]), to: Number(match[4]), inner: match[5], footnoteList: match[1] === 'section' };
}

/**
 * 文書全体の脚注ID（Markdownは`[^id]:`の定義の順、Textileは`fnN.`の番号）を集める。
 * ブロックごとに変換するときに、参照と定義の対応を文書全体と揃えるために変換器へ渡す。
 * @param source - 原文。
 * @param from - 原文の記法。
 * @returns 脚注ID。
 */
function collectFootnoteIds(source: string, from: DocumentSyntax): string[] {
    const pattern = from === 'markdown' ? /^ {0,3}\[\^([^\]\s]+)\]:/gm : /^fn(\d+)[^.\s]*\.\s/gm;
    return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))];
}

/**
 * 変換単位の書き換え候補を、元の記法へ戻る見込みの高い順に作る。重複は除く。どの候補もHTMLを新たに書き出さない。
 * 1. 逆変換モードの変換（順変換の規則の逆）。2. 通常の変換。変換器が「プレビューが変わる」と報告した変換は、ここでは候補にしない。
 * 3. 原文が生HTMLの単位なら、描画HTMLを規則で変換先の記法へ戻したもの（`<img>`を画像の記法にするなど）。
 * 4. 原文のまま。Markdown文書のプレビューはTextileの記法も描画し、どちらの記法も生HTMLを描画するため、
 *    変換先に同じ意味の記法がない書き方（Textileのclass付き段落・`notextile.`、原文の生HTMLなど）はそのまま残す。
 * 5. 最後の手段として、報告があっても通常の変換（どの候補も比較で一致しない単位に使う）。
 * @param text - 単位の原文。
 * @param renderedHtml - 単位の変換前の描画HTML。
 * @param from - 原文の記法。
 * @param to - 変換先の記法。
 * @param eol - 改行コード。
 * @param context - 文書全体の脚注ID（{@link collectFootnoteIds}）・参照リンクの定義と、Markdownだけの文書として扱う指定。
 * @returns 候補の一覧（末尾の改行は原文と同じ）と、記法へ書き換えた候補の数（`converted`。原文のままの候補より前に並ぶ）。
 */
function buildCandidates(
    text: string,
    renderedHtml: string,
    from: DocumentSyntax,
    to: DocumentSyntax,
    eol: string,
    context: Pick<DocumentConversionOptions, 'footnotes' | 'references' | 'markdownOnly'>
): { list: string[]; converted: number } {
    const trailing = /(?:\r\n|\r|\n)*$/.exec(text)?.[0] ?? '';
    const body = text.slice(0, text.length - trailing.length);
    const candidates: string[] = [];
    for (const restore of [true, false]) {
        const result = convertDocumentSyntax(text, from, to, { ...context, restore });
        if (result.unsupportedLines.length === 0) candidates.push(result.text);
    }
    // 原文が生HTMLの単位だけ、描画HTMLを記法へ戻す候補を作る（原文にないHTMLは書き出さないため、記法の単位には使わない）。
    if (/^\s*<[A-Za-z]/.test(body)) {
        const converted = to === 'markdown'
            ? [htmlToMarkdown(renderedHtml, eol), htmlToMarkdown(renderedHtml, eol, true)]
            : [htmlToTextile(renderedHtml, eol, false, from === 'markdown' ? context.footnotes : []), htmlToTextile(renderedHtml, eol, true, from === 'markdown' ? context.footnotes : [])];
        for (const candidate of converted) if (candidate) candidates.push(candidate + trailing);
    }
    const unique = [...new Set(candidates)];
    const converted = unique.length;
    // 原文のままの候補はTextile→Markdownだけに使う（Markdown文書のプレビューはTextileの記法も同じ意味で描画する）。
    // TextileのプレビューはMarkdownの記法を描画せず、`- `で始まる行が続く原文はtextile-jsの定義リストの解析が
    // 極端に遅くなるため、Markdown→Textileでは使わない。
    if (to === 'markdown' && !unique.includes(text)) unique.push(text);
    const fallback = convertDocumentSyntax(text, from, to, context).text;
    if (!unique.includes(fallback)) unique.push(fallback);
    return { list: unique, converted };
}

/**
 * 描画比較を1回だけ行う関数の型。
 */
type BlockComparer = (left: string, leftFormat: MarkdownRenderFormat, right: string, rightFormat: MarkdownRenderFormat) => Promise<boolean>;

/**
 * 候補が複数ある単位について、単位だけを描画して見た目が同じ最初の候補を選ぶ。
 * 文書全体の描画比較で1つずつ候補を試すと描画の回数が単位数に比例して増えるため、先に単位ごとに絞り込む。
 * 単位だけの描画は前後の文脈を含まないため、最終的な一致は呼び出し側の文書全体の比較で確かめる。
 * @param text - 単位の原文。
 * @param candidates - 候補。
 * @param fromFormat - 原文の描画形式。
 * @param toFormat - 変換先の描画形式。
 * @param compare - 描画比較。
 * @returns 選んだ候補の番号。どれも合わなければundefined。
 */
async function chooseCandidate(
    text: string,
    candidates: readonly string[],
    fromFormat: MarkdownRenderFormat,
    toFormat: MarkdownRenderFormat,
    compare: BlockComparer
): Promise<number | undefined> {
    for (let index = 0; index < candidates.length; index += 1) {
        if (await compare(text, fromFormat, candidates[index], toFormat)) return index;
    }
    return undefined;
}

/**
 * 原文を変換単位へ分ける。描画器のブロックの範囲を使い、範囲の間にある描画されない原文も単位にする。
 * Markdownの脚注一覧（文書末尾の`<section>`）は定義の位置の単位ではないため単位にしない（定義は描画されない単位として変換する）。
 * @param source - 原文。
 * @param blocks - 原文をブロックごとに描画した結果。
 * @returns 原文の順に並んだ変換単位。範囲を持たないブロックや重なる範囲がある場合はundefined。
 */
function splitUnits(source: string, blocks: ReadonlyArray<{ html: string }>): ConversionUnit[] | undefined {
    const ranged = blocks.map((block) => readBlock(block.html));
    if (ranged.some((block) => block === undefined)) return undefined;
    const units: ConversionUnit[] = [];
    let cursor = 0;
    /**
     * 位置がCRLFの\rと\nの間にあれば、\nの後ろへ動かす。描画器の範囲がCRLFを分けると、単位の末尾に単独の\rが残り、
     * 変換先で改行や空行の数え方が変わる（段落と後続のブロックがつながる）ため。
     * @param offset - 位置。
     * @returns CRLFを分けない位置。
     */
    const avoidSplitCrlf = (offset: number): number => (source[offset - 1] === '\r' && source[offset] === '\n' ? offset + 1 : offset);
    /**
     * 描画されない原文を単位にする。先頭の空行は単位の間の空白として扱い、単位に含めない（組み立てで空行を補うため、
     * 単位に含めると空行が重なる）。
     * @param from - 原文の開始位置。
     * @param to - 原文の終了位置。
     */
    const pushHidden = (from: number, to: number): void => {
        if (!source.slice(from, to).trim()) return;
        const lead = /^(?:[ \t]*(?:\r\n|\r|\n))*/.exec(source.slice(from, to))?.[0].length ?? 0;
        units.push({ from: from + lead, to, html: '', hidden: true });
    };
    for (const raw of (ranged as Array<{ from: number; to: number; inner: string; footnoteList: boolean }>).sort((a, b) => a.from - b.from)) {
        if (raw.footnoteList) continue;
        const block = { ...raw, from: avoidSplitCrlf(raw.from), to: avoidSplitCrlf(raw.to) };
        if (block.from < cursor) return undefined;
        pushHidden(cursor, block.from);
        if (block.to > block.from) units.push({ from: block.from, to: block.to, html: block.inner, hidden: false });
        cursor = Math.max(cursor, block.to);
    }
    pushHidden(cursor, source.length);
    return mergeOpenHtmlUnits(source, units);
}

/**
 * 生HTMLの要素を開いたまま終わる単位（`<details>`の開始タグと`<summary>`だけの単位など）を、閉じタグを含む単位までまとめる。
 * 描画器は空行で区切ったまとまりごとにブロックを作るが、要素の中身を別の単位として変換すると、変換先で要素が途中で閉じるため。
 * @param source - 原文。
 * @param units - 単位。
 * @returns まとめた単位。閉じタグが見つからない単位はまとめない。
 */
function mergeOpenHtmlUnits(source: string, units: readonly ConversionUnit[]): ConversionUnit[] {
    const merged: ConversionUnit[] = [];
    for (let index = 0; index < units.length; index += 1) {
        const unit = units[index];
        const open = /^\s*<([A-Za-z][\w-]*)\b[^<>]*>/.exec(source.slice(unit.from, unit.to));
        if (unit.hidden || !open) {
            merged.push(unit);
            continue;
        }
        /**
         * 指定の範囲で、開始タグの要素が開いたままの数を数える。
         * @param to - 範囲の終端。
         * @returns 開いたままの数。
         */
        const balance = (to: number): number => {
            let depth = 0;
            for (const tag of source.slice(unit.from, to).matchAll(new RegExp(String.raw`<(/?)${open[1]}\b[^<>]*>`, 'gi'))) depth += tag[1] ? -1 : 1;
            return depth;
        };
        let last = index;
        while (balance(units[last].to) > 0 && last + 1 < units.length) last += 1;
        if (last === index || balance(units[last].to) > 0) {
            merged.push(unit);
            continue;
        }
        merged.push({ from: unit.from, to: units[last].to, html: units.slice(index, last + 1).map((item) => item.html).join(''), hidden: false });
        index = last;
    }
    return merged;
}

/** 1行だけのMarkdownの脚注の定義（`[^id]: 本文`と末尾の改行）。 */
const SINGLE_FOOTNOTE_DEFINITION = /^\[\^[^\]\s]+\]:[^\r\n]*(?:\r\n|\r|\n)*$/;

/**
 * Textileの文字列を書いた後に、複数段落ブロック（`bc..`など）が開いたまま（次の署名まで続く状態）か判定する。
 * 空行で区切ったブロックを順にたどり、署名で始まるブロックはその署名が複数段落か、署名のないブロックは直前の状態を引き継ぐ
 * （開いていれば複数段落ブロックの続き、閉じていれば通常の段落）。
 * @param text - 書いたTextile。
 * @param open - 書く前に複数段落ブロックが開いていたか。
 * @returns 書いた後に開いていればtrue。
 */
function endsInsideExtendedBlock(text: string, open: boolean): boolean {
    let state = open;
    for (const block of text.split(/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/)) {
        const trimmed = block.replace(/^(?:[ \t]*(?:\r\n|\r|\n))+/, '');
        if (!trimmed.trim()) continue;
        if (TEXTILE_SIGNATURE_START.test(trimmed)) state = TEXTILE_EXTENDED_START.test(trimmed);
    }
    return state;
}

/**
 * 変換単位を組み立てる。単位の間の空白は原文のまま残し、単位の間に空行がなければ空行を補う
 * （Textileは空行までを1つのブロックとして扱うため）。Textileの複数段落ブロック（`bc..`・`bq..`・`###..`など）は
 * 次の署名まで続くため、後ろの段落には`p.`を付け、段落以外のブロック（リスト・表など）の前には空の段落`p. `を置いて閉じる。
 * Markdownへの変換で原文のまま残したTextileの複数段落ブロックも、Markdown文書のプレビューが同じく次の署名まで続けるため、
 * 後ろに空の段落`p. `を置いて閉じる。
 * @param source - 原文。
 * @param units - 変換単位。
 * @param texts - 単位ごとの変換先の文字列。空文字の単位は何も書かない。
 * @param target - 変換先の記法。
 * @returns 組み立てた文書。
 */
function assemble(source: string, units: readonly ConversionUnit[], texts: readonly string[], target: DocumentSyntax): string {
    const eol = /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
    let output = '';
    let cursor = 0;
    let extendedOpen = false;
    let previous = '';
    units.forEach((unit, index) => {
        const text = texts[index];
        // 何も書かない単位（参照リンクの定義など）は、空行を重ねないよう前の空白も書かない。
        // 全角空白だけの段落などは書く単位なので、空白とタブ・改行だけの場合に限る（String.prototype.trimは全角空白も除く）。
        if (/^[ \t\r\n]*$/.test(text)) {
            cursor = unit.to;
            return;
        }
        // Textileの脚注（`fnN.`）は空行で区切った別のブロックだが、Markdownの脚注の定義は続けて書ける。
        // Markdown→Textileの順変換が続いた定義の間に空行を補う逆として、1行の定義が続く場合は空行を入れない。
        if (target === 'markdown' && SINGLE_FOOTNOTE_DEFINITION.test(previous) && SINGLE_FOOTNOTE_DEFINITION.test(text) && !source.slice(cursor, unit.from).trim()) {
            output = output.replace(/(?:[ \t]*(?:\r\n|\r|\n))*$/, eol) + text;
            previous = text;
            cursor = unit.to;
            return;
        }
        previous = text;
        let gap = source.slice(cursor, unit.from);
        // 直前までの出力が空行で終わっていなければ、改行を足して空行にする（多くても2回）。
        while (output && !ENDS_WITH_BLANK_LINE.test(output + gap)) gap += eol;
        output += gap;
        if (extendedOpen && !TEXTILE_SIGNATURE_START.test(text)) {
            // Markdownでは、原文のまま残したTextileの複数段落ブロック（Markdown文書のプレビューもTextileとして次の署名まで続ける）の
            // 後ろに、空の段落`p. `を置いて閉じる（後ろはMarkdownの記法なので、`p.`を付けて書き換えない）。
            // Markdownの段落に`p.`を付けるとTextileの段落として描画されるため、Markdownのインライン記法を含まない段落に限る。
            const paragraph = target === 'textile'
                ? !TEXTILE_NON_PARAGRAPH_START.test(text)
                : !MARKDOWN_NON_PARAGRAPH_START.test(text) && !/[`*_[\]!<~\\$=^]/.test(text);
            output += paragraph ? `p. ${text}` : `p. ${eol}${eol}${text}`;
            extendedOpen = false;
        } else {
            output += text;
        }
        extendedOpen = endsInsideExtendedBlock(text, extendedOpen);
        cursor = unit.to;
    });
    output += source.slice(cursor);
    // 末尾の単位を書かなかった場合も、原文の末尾改行の有無は保つ。
    if (/(?:\r\n|\r|\n)$/.test(source) && output && !/(?:\r\n|\r|\n)$/.test(output)) output += eol;
    return output;
}

/**
 * 文書全体を変換先の記法へ書き換え、プレビューが変わらないことを描画の比較で確かめる。
 * 単位ごとに候補（{@link buildCandidates}）を試し、比較が一致するまで違いの出た単位を次の候補へ切り替える。
 * 一致させきれない場合も、単位ごとに選んだ候補で組み立てた結果を返す（HTMLへは変換しない）。
 * 呼び出し側は中止された場合を除いて結果を必ず適用する（変換を止めない）。`equal`がfalseなら、見た目が変わり得ることを利用者へ知らせる。
 * 文書先頭のYAML front matterは、Markdown→TextileではTextileのコメント（`###.`、空行を含む場合は`###..`と閉じるための`p. `）にし、
 * Textile→Markdownでは先頭のその形のコメントをfront matterへ戻す。front matterは描画の比較の対象外とする
 * （Markdownのプレビューはfront matterを水平線と見出しとして表示するが、Textileでは表示されないメタデータとして扱うため）。
 * @param source - 変換前の文書。
 * @param from - 変換前の記法。
 * @param fromFormat - 変換前のプレビューの描画形式。
 * @param to - 変換先の記法。
 * @param toFormat - 変換後のプレビューの描画形式。
 * @param render - 描画関数。比較の途中で例外になった描画は、その候補の不一致として扱う。最初の描画の例外は呼び出し側へ伝える。
 * @param isCancelled - 本文が変わるなどして変換を続ける意味がなくなった場合にtrueを返す関数。描画のたびに確かめて打ち切る。
 * @returns 変換結果。中止した場合は`cancelled`がtrueで、`text`は原文。
 */
export async function convertPreservingPreview(
    source: string,
    from: DocumentSyntax,
    fromFormat: MarkdownRenderFormat,
    to: DocumentSyntax,
    toFormat: MarkdownRenderFormat,
    render: PreviewBlockRenderer,
    isCancelled: () => boolean = () => false
): Promise<PreservingConversionResult> {
    const eol = /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
    if (from === 'markdown' && to === 'textile') {
        const frontMatter = FRONT_MATTER.exec(source)?.[0];
        if (frontMatter) {
            const content = frontMatter.replace(/(?:\r\n|\r|\n)$/, '');
            const extended = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.test(content);
            let rest = source.slice(frontMatter.length);
            // コメントは空行まで続くため、本文がfront matterの直後の行から始まる場合は空行を補う。
            if (rest.trim() && !/^[ \t]*(?:\r\n|\r|\n)/.test(rest)) rest = eol + rest;
            const result = await convertWithVerification(rest, from, fromFormat, to, toFormat, render, isCancelled);
            const header = `###${extended ? '..' : '.'} ${content}${extended ? `${eol}${eol}p. ` : ''}`;
            return result.cancelled ? { ...result, text: source } : { ...result, text: `${header}${frontMatter.length < source.length || /(?:\r\n|\r|\n)$/.test(frontMatter) ? eol : ''}${result.text}` };
        }
    }
    if (from === 'textile' && to === 'markdown') {
        const comment = FRONT_MATTER_COMMENT.exec(source);
        if (comment) {
            const result = await convertWithVerification(source.slice(comment[0].length), from, fromFormat, to, toFormat, render, isCancelled);
            const newline = /(?:\r\n|\r|\n)$/.test(comment[0]) ? eol : '';
            return result.cancelled ? { ...result, text: source } : { ...result, text: `${comment[1]}${newline}${result.text}` };
        }
    }
    return convertWithVerification(source, from, fromFormat, to, toFormat, render, isCancelled);
}

/**
 * {@link convertPreservingPreview}の本体（front matterを除いた文書の変換）。引数と戻り値は{@link convertPreservingPreview}と同じ。
 * @param source - 変換前の文書。
 * @param from - 変換前の記法。
 * @param fromFormat - 変換前のプレビューの描画形式。
 * @param to - 変換先の記法。
 * @param toFormat - 変換後のプレビューの描画形式。
 * @param render - 描画関数。
 * @param isCancelled - 打ち切りの判定。
 * @returns 変換結果。
 */
async function convertWithVerification(
    source: string,
    from: DocumentSyntax,
    fromFormat: MarkdownRenderFormat,
    to: DocumentSyntax,
    toFormat: MarkdownRenderFormat,
    render: PreviewBlockRenderer,
    isCancelled: () => boolean
): Promise<PreservingConversionResult> {
    const eol = /\r\n|\r|\n/.exec(source)?.[0] ?? '\n';
    const cancelled: PreservingConversionResult = { text: source, equal: false, cancelled: true };
    // Markdown文書のプレビュー（混在形式）は、Textileの書き方の候補を含まない文書をMarkdownだけとして描画する。
    // 変換器にも同じ扱いをさせ、単位だけの描画もMarkdownだけとして比べる（単位だけだと候補の有無が文書全体と変わるため）。
    const markdownOnly = from === 'markdown' && fromFormat === 'mixed' && !hasMixedTextileSyntaxCandidate(source);
    const unitFromFormat: MarkdownRenderFormat = markdownOnly ? 'markdown' : fromFormat;
    const context = {
        footnotes: collectFootnoteIds(source, from),
        references: from === 'markdown' ? collectLinkReferences(source) : [],
        markdownOnly,
    };
    /**
     * 組み立てた文書を描画して変換前と比べる。描画器が解釈できず例外になった場合は違いとして扱う。
     * @param text - 変換後の文書。
     * @returns 比較の結果。
     */
    const compareDocument = async (text: string): Promise<ReturnType<typeof comparePreviewBlocks>> => {
        let after: ReadonlyArray<{ html: string }>;
        try {
            after = await render(text, toFormat);
        } catch {
            after = [];
        }
        return comparePreviewBlocks(before, after);
    };
    const before = await render(source, fromFormat);
    const units = splitUnits(source, before);
    if (!units) {
        // ブロックの位置が取れない描画（想定外）は、文書全体を記法の変換だけで書き換える。
        const restored = convertDocumentSyntax(source, from, to, { ...context, restore: true });
        const text = restored.unsupportedLines.length === 0 ? restored.text : convertDocumentSyntax(source, from, to, context).text;
        const comparison = await compareDocument(text);
        return { text, equal: comparison.equal, cancelled: false, firstDifferenceOffset: comparison.firstDifferenceOffset };
    }
    /** 単位の原文の描画（描画形式と原文をキーにする）。候補ごとに同じ原文を描画し直さないために保持する。 */
    const unitRenders = new Map<string, Promise<ReadonlyArray<{ html: string }>>>();
    /**
     * 単位だけを描画して比べる。
     * @param left - 変換前の原文。
     * @param leftFormat - 変換前の描画形式。
     * @param right - 変換後の原文。
     * @param rightFormat - 変換後の描画形式。
     * @returns 意味が同じならtrue。
     */
    const compareUnit: BlockComparer = async (left, leftFormat, right, rightFormat) => {
        // 同じ単位の候補を順に比べるとき、原文側の描画は毎回同じなので1度だけ描画して使い回す。
        const key = `${leftFormat}\u0000${left}`;
        if (!unitRenders.has(key)) unitRenders.set(key, render(left, leftFormat));
        // 候補の記法を描画器が解釈できず例外になった場合は、その候補は合わないものとして次の候補へ進む。
        try {
            const [a, b] = await Promise.all([unitRenders.get(key) as Promise<ReadonlyArray<{ html: string }>>, render(right, rightFormat)]);
            return comparePreviewBlocks(a, b).equal;
        } catch {
            return false;
        }
    };
    const candidates: string[][] = [];
    const choice: number[] = [];
    for (const unit of units) {
        if (isCancelled()) return cancelled;
        const original = source.slice(unit.from, unit.to);
        const { list, converted } = buildCandidates(original, unit.html, from, to, eol, context);
        candidates.push(list);
        // 描画されない単位（脚注定義・参照リンクの定義など）は単位だけでは比べられないため、最初の候補から文書全体の比較で試す。
        // 記法へ書き換えた候補が複数ある単位は、単位だけの描画で絞り込む。原文のままの候補は単位だけの描画では選ばない
        // （脚注参照など文脈で描画が変わる単位では、文脈のない描画どうしが偶然一致するため）。どれも合わなければ最初の候補から
        // 文書全体の比較で試し、違いが出れば原文のままの候補・報告付きの通常の変換へ進む。
        let chosen = unit.hidden || converted <= 1 ? 0 : await chooseCandidate(original, list.slice(0, converted), unitFromFormat, toFormat, compareUnit);
        // 記法へ書き換えた候補がない単位（変換器が報告した単位）は、原文のままの候補が単位だけの描画で一致する場合だけそれを使い、
        // 一致しなければ報告付きの通常の変換（同じ意味の記法。描画器の違いで見た目が変わり得る）を使う。
        if (converted === 0 && !unit.hidden) {
            const raw = list.indexOf(original);
            chosen = raw >= 0 && await compareUnit(original, unitFromFormat, original, toFormat) ? raw : list.length - 1;
        }
        choice.push(chosen ?? 0);
    }
    const initial = [...choice];
    /**
     * 選択に従って単位ごとの文字列を返す。
     * @param selection - 単位ごとの候補の番号。
     * @returns 単位ごとの文字列。
     */
    const textsOf = (selection: readonly number[]): string[] => units.map((_, index) => candidates[index][selection[index]]);
    let lastDifference: number | undefined;
    let stepsBack = 0;
    for (let round = 0; round < MAX_VERIFY_ROUNDS; round += 1) {
        if (isCancelled()) return cancelled;
        const text = assemble(source, units, textsOf(choice), to);
        const comparison = await compareDocument(text);
        if (comparison.equal) return { text, equal: true, cancelled: false };
        lastDifference = comparison.firstDifferenceOffset;
        // 違いが最初に現れた単位（違いの位置を含む、または直前の単位）を次の候補へ切り替えて描画し直す。
        let target = -1;
        units.forEach((unit, index) => {
            if (lastDifference !== undefined && unit.from <= lastDifference) target = index;
        });
        if (target < 0 || choice[target] + 1 >= candidates[target].length) {
            // 候補を使い切った単位で違いが残る場合は、直前の単位の書き換えが後続の描画へ影響したとみなし、
            // 直前のまだ候補が残る単位を切り替える。遡りは MAX_STEPS_BACK 回までとする。
            stepsBack += 1;
            if (stepsBack > MAX_STEPS_BACK) break;
            let previous = target - 1;
            while (previous >= 0 && choice[previous] + 1 >= candidates[previous].length) previous -= 1;
            if (previous < 0) break;
            target = previous;
        }
        choice[target] += 1;
    }
    if (isCancelled()) return cancelled;
    // 一致させきれない文書は、単位ごとに選んだ候補で組み立てて返す（変換を止めない）。違いの位置は利用者へ通知する。
    const text = assemble(source, units, textsOf(initial), to);
    const comparison = await compareDocument(text);
    return {
        text,
        equal: comparison.equal,
        cancelled: false,
        firstDifferenceOffset: comparison.equal ? undefined : comparison.firstDifferenceOffset ?? lastDifference,
    };
}
