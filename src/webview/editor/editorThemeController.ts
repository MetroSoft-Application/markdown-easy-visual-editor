/**
 * @fileoverview VS Codeのテーマ状態をWebviewへ反映し、テーマ変更時にエディターとプレビューの配色を更新する。
 */
import type { EditorTheme, HostToWebviewMessage } from '../../shared/protocol';

/**
 * 編集テーマ制御のthemesとして順序を保つ一覧。
 */
const THEMES: readonly EditorTheme[] = ['light', 'dark'];
/**
 * CodeMirror編集面へ現在適用しているテーマID。
 */
let currentTheme: EditorTheme = 'dark';

/**
 * エディターのテーマ変更イベントを購読し、現在のCodeMirrorテーマを切り替える。
 * @returns テーマ変更イベントの購読を解除する関数。
 */
export function installEditorThemeController(): () => void {
    applyTheme(currentTheme);


    const onMessage = /**
     * 編集テーマ制御のイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - hostからeditor theme設定を受け取るmessage event。
     */ (event: MessageEvent<HostToWebviewMessage>) => {
            const message = event.data;
            if (message.type !== 'init' && message.type !== 'settingsChanged') return;
            setCurrentTheme(message.settings.editorTheme ?? 'dark');
        };


    const onChange = /**
     * change操作を表示または編集状態へ反映する。
     * @param event - theme選択欄のchange event。
     */ (event: Event) => {
            const select = event.target instanceof HTMLSelectElement ? event.target : undefined;
            if (!select?.classList.contains('mve-editor-theme-select')) return;
            const theme = select.value as EditorTheme;
            if (!THEMES.includes(theme)) return;
            setCurrentTheme(theme);
        };
    window.addEventListener('message', onMessage);
    document.addEventListener('change', onChange);
    return () => {
        window.removeEventListener('message', onMessage);
        document.removeEventListener('change', onChange);
    };
}

/**
 * 編集テーマ制御の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param theme - 描画や表示に適用する配色テーマ。
 */
function setCurrentTheme(theme: EditorTheme): void {
    currentTheme = THEMES.includes(theme) ? theme : 'dark';
    applyTheme(currentTheme);
    const select = document.querySelector<HTMLSelectElement>('.mve-editor-theme-select');
    if (select && select.value !== currentTheme) select.value = currentTheme;
}

/**
 * 編集テーマ制御の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param theme - 描画や表示に適用する配色テーマ。
 */
function applyTheme(theme: EditorTheme): void {
    document.documentElement.dataset.editorTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.dataset.editorTheme = theme;
    document.body.style.colorScheme = theme;
    document.body.classList.toggle('vscode-light', theme === 'light');
    document.body.classList.toggle('vscode-dark', theme === 'dark');
}
