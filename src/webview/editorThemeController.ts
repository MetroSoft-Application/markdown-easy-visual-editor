/**
 * @file editorThemeController.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type { EditorTheme, HostToWebviewMessage } from '../shared/protocol';

/** 「THEMES」は、関連する処理間で共有する設定値または状態です。 */
const THEMES: readonly EditorTheme[] = ['light', 'dark'];
/** 「currentTheme」は、関連する処理間で共有する設定値または状態です。 */
let currentTheme: EditorTheme = 'dark';

/**
 * ホストから届くエディターテーマ設定を画面とリボンへ反映し、リボン操作は保存応答を待たず即時適用する。
 * @returns 破棄時に呼び出すクリーンアップ関数。
 */
export function installEditorThemeController(): () => void {
    applyTheme(currentTheme);

    /**
     * 「onMessage」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「if」を実行し、値を返しません。
     */
    const onMessage = /**
 * 「onMessage」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「if」を実行し、値を返しません。
 */ (event: MessageEvent<HostToWebviewMessage>) => {
        const message = event.data;
        if (message.type !== 'init' && message.type !== 'settingsChanged') return;
        setCurrentTheme(message.settings.editorTheme ?? 'dark');
    };

    /**
     * 「onChange」は、イベント入力を受け取り、関連する状態またはUIを更新する処理です。
     * @param event 処理対象のイベントです。
     * @returns 「event」から生成した処理結果を返します。
     */
    const onChange = /**
 * 「onChange」は、イベント入力を検証し、関連する状態またはUIを更新します。
 * @param event DOMイベントまたは入力イベントの情報です。
 * @returns 「event」から生成した処理結果を返します。
 */ (event: Event) => {
        const select = event.target instanceof HTMLSelectElement ? event.target : undefined;
        if (!select?.classList.contains('mve-editor-theme-select')) return;
        const theme = select.value as EditorTheme;
        if (!THEMES.includes(theme)) return;
        setCurrentTheme(theme);
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('change', onChange);
    return /** イベント情報を受け取り、DOMまたは画面状態を更新するコールバックです。 @returns 後片付けまたは登録解除を完了した結果を返します。 */ () => {
        window.removeEventListener('message', onMessage);
        document.removeEventListener('change', onChange);
    };
}

/**
 * 現在テーマを画面へ反映し、表示中のリボン選択値も更新する。
 * @param theme 処理対象のテーマです。
 * @returns 「setCurrentTheme」の副作用または状態更新を実行し、値は返しません。
 */
function setCurrentTheme(theme: EditorTheme): void {
    currentTheme = THEMES.includes(theme) ? theme : 'dark';
    applyTheme(currentTheme);
    const select = document.querySelector<HTMLSelectElement>('.mve-editor-theme-select');
    if (select && select.value !== currentTheme) select.value = currentTheme;
}

/**
 * html/bodyへ独自テーマ状態を設定し、Webview内でVS Codeテーマクラスを参照する処理も同じlight/darkへ揃える。
 * 高コントラスト状態はアクセシビリティ情報として保持する。
 * @param theme 処理対象のテーマです。
 * @returns 「applyTheme」の副作用または状態更新を実行し、値は返しません。
 */
function applyTheme(theme: EditorTheme): void {
    document.documentElement.dataset.editorTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.dataset.editorTheme = theme;
    document.body.style.colorScheme = theme;
    document.body.classList.toggle('vscode-light', theme === 'light');
    document.body.classList.toggle('vscode-dark', theme === 'dark');
}
