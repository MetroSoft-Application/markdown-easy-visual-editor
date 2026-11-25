/**
 * @fileoverview プレビューの見出し番号の設定を保持し、番号を描くCSSを文書へ適用する（Webview）。
 * 設定はHostの`init` / `settingsChanged`で受け取り、リボンで変更したときはHostへ保存を依頼する。
 * CSSは`<style>`要素1つだけで管理し、番号なしのときは中身を空にする。プレビューのDOMとMarkdown原文は変更しない。
 */
import type { HostToWebviewMessage } from '../../shared/protocol';
import {
    DEFAULT_HEADING_NUMBERING_MODE,
    headingNumberingCss,
    normalizeHeadingNumberingMode,
    type HeadingNumberingMode
} from '../../shared/headingNumbering';
import { sharedVsCodeApi } from '../runtime/vscodeApi';

/** 番号のCSSを入れる`<style>`要素のid。 */
const STYLE_ELEMENT_ID = 'mve-heading-numbering-style';

/**
 * プレビューの番号のカウンターを初期化する要素。分割表示・プレビューのみ・出力用の描画は、それぞれ別の`.rendered-markdown`を持つため、
 * 描画ごとに1から数える。
 */
const PREVIEW_ROOT_SELECTOR = '.rendered-markdown';

/** 現在の番号付けモード。 */
let mode: HeadingNumberingMode = DEFAULT_HEADING_NUMBERING_MODE;

/** モードの変化を受け取る購読者。 */
const listeners = new Set<(value: HeadingNumberingMode) => void>();

/**
 * 現在の番号付けモードを返す。印刷プレビュー・出力要求の時点の値として使う。
 * @returns 番号付けモード。
 */
export function getPreviewHeadingNumbering(): HeadingNumberingMode {
    return mode;
}

/**
 * 利用者の操作で番号付けモードを変える。すぐにプレビューへ反映し、Hostへグローバル設定の保存を依頼する。
 * @param next - 新しいモード。未知の値は`off`として扱う。
 */
export function setPreviewHeadingNumbering(next: HeadingNumberingMode): void {
    const normalized = normalizeHeadingNumberingMode(next);
    applyHeadingNumbering(normalized);
    sharedVsCodeApi.postMessage({ type: 'setHeadingNumbering', mode: normalized });
}

/**
 * 番号付けモードを購読する。登録時に現在の値を1回通知する。
 * @param listener - 現在と以後のモードを受け取る関数。
 * @returns 購読を解除する関数。
 */
export function subscribePreviewHeadingNumbering(listener: (value: HeadingNumberingMode) => void): () => void {
    listeners.add(listener);
    listener(mode);
    /** この購読者を外す。 */
    return () => listeners.delete(listener);
}

/**
 * Hostからの設定通知の受信を始める。Webviewの起動時に1回だけ呼ぶ。Webviewの破棄とともに解除されるため、解除関数は持たない。
 */
export function installPreviewHeadingNumbering(): void {
    window.addEventListener('message', handleHostSettings);
}

/**
 * Hostの設定通知から番号付けモードを読み取って反映する。旧Hostで未指定の場合は`off`。
 * @param event - windowへ送られたHostメッセージ。
 */
function handleHostSettings(event: MessageEvent): void {
    const message = event.data as HostToWebviewMessage | undefined;
    if (!message || (message.type !== 'init' && message.type !== 'settingsChanged')) return;
    applyHeadingNumbering(normalizeHeadingNumberingMode(message.settings.headingNumbering));
}

/**
 * モードをCSSへ反映し、変わった場合は購読者へ通知する。
 * @param next - 正規化済みのモード。
 */
function applyHeadingNumbering(next: HeadingNumberingMode): void {
    const changed = mode !== next;
    mode = next;
    let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ELEMENT_ID;
        document.head.appendChild(style);
    }
    const css = headingNumberingCss(next, PREVIEW_ROOT_SELECTOR);
    if (style.textContent !== css) style.textContent = css;
    if (changed) {
        for (const listener of listeners) listener(next);
    }
}
