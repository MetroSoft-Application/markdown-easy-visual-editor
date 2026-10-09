/**
 * @fileoverview 選択中の本文文字列をCodeMirror検索欄へ転記し、範囲内検索の開始位置をそろえる。
 */
import { EditorView } from '@codemirror/view';

/**
 * 検索文字列の転送リスナーを登録済みか示す。
 */
let installed = false;

/**
 * 選択中のエディター本文を検索UIへ渡すメッセージを登録する。
 */
export function installSelectedTextSearchTransfer(): void {
    if (installed) return;
    installed = true;


    const scheduleTransfer = /**
     * searchselectedtextの処理順序と完了状態を管理する。
     */ (): void => {
            window.requestAnimationFrame(
                /**
                 * 次の描画フレームで表示更新を実行する。
                 */
                () => {
                    const panel = document.querySelector<HTMLElement>('.search-panel');
                    if (!panel) return;
                    transferSelectionToSearch(panel);
                });
        };


    const handleKeyDown = /**
     * searchselectedtextのイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - Ctrl/Cmd+Fで選択文字列を検索欄へ送るkeydown event。
     */ (event: KeyboardEvent): void => {
            if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'f') return;
            scheduleTransfer();
        };


    const handleClick = /**
     * searchselectedtextのイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - 選択文字列を検索欄へ移すsource button click event。
     */ (event: MouseEvent): void => {
            const target = event.target instanceof Element
                ? event.target.closest<HTMLButtonElement>('button.ribbon-source-button')
                : null;
            if (!target) return;
            scheduleTransfer();
        };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClick, true);
}

/**
 * 選択中の文字列を指定した検索欄へ転送する。
 * @param panel 検索文字列を書き込む入力要素。
 */
function transferSelectionToSearch(panel: HTMLElement): void {
    const editorElement = findVisibleEditorElement();
    if (!editorElement) return;

    const view = EditorView.findFromDOM(editorElement);
    if (!view) return;

    const selection = view.state.selection.main;
    if (selection.empty) {
        focusSearchInput(panel);
        return;
    }

    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    if (!selectedText) {
        focusSearchInput(panel);
        return;
    }

    // 検索欄は<input type="text">なので改行を保持できない。複数行選択を勝手に連結しない。
    if (/\r|\n/.test(selectedText)) {
        focusSearchInput(panel);
        return;
    }

    const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
    if (!input) return;

    if (input.value !== selectedText) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!valueSetter) return;
        valueSetter.call(input, selectedText);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    input.focus();
    input.select();
}

/**
 * searchselectedtextの表示または操作を開始する。
 * @param panel - 検索欄を含む検索パネル要素。
 */
function focusSearchInput(panel: HTMLElement): void {
    const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
    if (!input) return;
    input.focus();
    input.select();
}

/**
 * 表示中のソースエディター要素を取得する。
 * @returns 選択文字列を取得する対象のエディター。見つからない場合はundefined。
 */
function findVisibleEditorElement(): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
        .find(
            (element) => element.getClientRects().length > 0);
}
