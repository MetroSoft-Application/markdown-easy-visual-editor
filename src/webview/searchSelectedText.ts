/**
 * @file searchSelectedText.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { EditorView } from '@codemirror/view';

/** 「installed」は、関連する処理間で共有する設定値または状態です。 */
let installed = false;

/**
 * 検索コマンドが呼ばれるたびに、ソースエディターで選択中の文字列を検索欄へ転送する。
 * 検索パネルを閉じなくても Ctrl/Cmd+F やリボンの検索を再実行すれば毎回選択を読み直す。
 * @returns 「installSelectedTextSearchTransfer」の副作用または状態更新を実行し、値は返しません。
 */
export function installSelectedTextSearchTransfer(): void {
    if (installed) return;
    installed = true;

    /**
     * React側の検索パネル表示更新後に、その時点の選択文字列を検索欄へ反映する。
     * @returns 「scheduleTransfer」の副作用または状態更新を実行し、値は返しません。
     */
    const scheduleTransfer = /**
 * 「scheduleTransfer」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @returns 「scheduleTransfer」がWebview UI状態の入力を処理して得た固有の結果を返します。
 */ (): void => {
        window.requestAnimationFrame(
        /**
 * 次の描画フレームでUI更新処理を実行するコールバックです。
         * @returns 「if」を実行し、値を返しません。
         */
        () => {
            const panel = document.querySelector<HTMLElement>('.search-panel');
            if (!panel) return;
            transferSelectionToSearch(panel);
        });
    };

    /**
     * Ctrl/Cmd+F は検索パネルの表示状態に関係なく毎回転送対象にする。
     * @param event 処理対象のイベントです。
     * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
     */
    const handleKeyDown = /**
 * 「handleKeyDown」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: KeyboardEvent): void => {
        if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'f') return;
        scheduleTransfer();
    };

    /**
     * リボンの検索ボタンも、表示中の検索パネルを閉じずに毎回転送対象にする。
     * @param event 処理対象のイベントです。
     * @returns イベントを処理し、状態更新または副作用だけを実行して値は返しません。
     */
    const handleClick = /**
 * 「handleClick」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
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
 * 現在表示されているCodeMirrorの主選択範囲を検索入力へ反映する。
 * Reactのcontrolled inputへ通知するため、ネイティブvalue setterの後にinputイベントを送る。
 * @param panel 「panel」は、「transferSelectionToSearch」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「transferSelectionToSearch」の副作用または状態更新を実行し、値は返しません。
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
 * 検索入力へフォーカスし、既存の検索文字列を全選択する。
 * @param panel 「panel」は、「focusSearchInput」がWebview UI状態の処理対象を特定する入力です。
 * @returns 「focusSearchInput」の副作用または状態更新を実行し、値は返しません。
 */
function focusSearchInput(panel: HTMLElement): void {
    const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
    if (!input) return;
    input.focus();
    input.select();
}

/**
 * 現在レイアウト上に表示されているソースエディターのDOMを返す。
 * @returns 「findVisibleEditorElement」が対象を取得できない場合はundefinedを返します。
 */
function findVisibleEditorElement(): HTMLElement | undefined {
    return Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
        .find(
        /**
 * 「element」が検索条件に一致するか判定するコールバックです。
         * @param element 処理対象の要素です。
         * @returns 条件に一致した要素、または該当しない場合はundefinedを返します。
         */
        (element) => element.getClientRects().length > 0);
}
