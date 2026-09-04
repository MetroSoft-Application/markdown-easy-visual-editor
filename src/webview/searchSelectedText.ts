import { EditorView } from '@codemirror/view';

let installed = false;

/**
 * 検索コマンドが呼ばれるたびに、ソースエディターで選択中の文字列を検索欄へ転送する。
 * 検索パネルを閉じなくても Ctrl/Cmd+F やリボンの検索を再実行すれば毎回選択を読み直す。
 */
export function installSelectedTextSearchTransfer(): void {
    if (installed) return;
    installed = true;

    /** React側の検索パネル表示更新後に、その時点の選択文字列を検索欄へ反映する。 */
    const scheduleTransfer = (): void => {
        window.requestAnimationFrame(() => {
            const panel = document.querySelector<HTMLElement>('.search-panel');
            if (!panel) return;
            transferSelectionToSearch(panel);
        });
    };

    /** Ctrl/Cmd+F は検索パネルの表示状態に関係なく毎回転送対象にする。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'f') return;
        scheduleTransfer();
    };

    /** リボンの検索ボタンも、表示中の検索パネルを閉じずに毎回転送対象にする。 */
    const handleClick = (event: MouseEvent): void => {
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
 * 現在表示されているCodeMirrorの主選択範囲を検索入力へ反映する。
 * Reactのcontrolled inputへ通知するため、ネイティブvalue setterの後にinputイベントを送る。
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

/** 検索入力へフォーカスし、既存の検索文字列を全選択する。 */
function focusSearchInput(panel: HTMLElement): void {
    const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
    if (!input) return;
    input.focus();
    input.select();
}

/** 現在レイアウト上に表示されているソースエディターのDOMを返す。 */
function findVisibleEditorElement(): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
        .find((element) => element.getClientRects().length > 0);
}
