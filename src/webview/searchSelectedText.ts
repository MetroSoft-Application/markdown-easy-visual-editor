/**
 * @fileoverview Webviewのsearchselectedtextを管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import { EditorView } from '@codemirror/view';

/**
 * searchselectedtextのinstalledに関する状態または設定。
 */
let installed = false;

/**
 * searchselectedtextのinstall・selected・text・search・transferを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 副作用を完了し、値は返さない。
 */
export function installSelectedTextSearchTransfer(): void {
    if (installed) return;
    installed = true;


    const scheduleTransfer = /**
     * searchselectedtextの処理順序と完了状態を管理する。
     * @returns 副作用を完了し、値は返さない。
     */ (): void => {
            window.requestAnimationFrame(
                /**
                 * 次の描画フレームで表示更新を実行する。
                 * @returns 副作用を完了し、値は返さない。
                 */
                () => {
                    const panel = document.querySelector<HTMLElement>('.search-panel');
                    if (!panel) return;
                    transferSelectionToSearch(panel);
                });
        };


    const handleKeyDown = /**
     * searchselectedtextのイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - ユーザー操作またはDOMから通知されたイベント。
     * @returns 副作用を完了し、値は返さない。
     */ (event: KeyboardEvent): void => {
            if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'f') return;
            scheduleTransfer();
        };


    const handleClick = /**
     * searchselectedtextのイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - ユーザー操作またはDOMから通知されたイベント。
     * @returns 副作用を完了し、値は返さない。
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
 * UIイベントを受け取り、必要な処理を実行する。
 * @param panel - ユーザー操作またはDOMから通知されたイベント。
 * @returns 副作用を完了し、値は返さない。
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
 * @param panel - searchselectedtextへ渡す入力。
 * @returns 副作用を完了し、値は返さない。
 */
function focusSearchInput(panel: HTMLElement): void {
    const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
    if (!input) return;
    input.focus();
    input.select();
}

/**
 * searchselectedtextから必要な値またはリソースを取得する。
 * @returns 条件に一致する値。未検出時はundefinedまたはnull。
 */
function findVisibleEditorElement(): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
        .find(
            /**
             * get・client・rectsが条件に一致する最初の要素を取得する。
             * @param element - 要素のget・client・rectsを参照する走査対象。
             * @returns 条件に一致した最初の要素。未検出時はundefined。
             */
            (element) => element.getClientRects().length > 0);
}
