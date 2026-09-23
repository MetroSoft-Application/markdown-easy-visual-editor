/**
 * @fileoverview Webviewの編集テーマ制御を管理する。Hostとの通信、ユーザー操作、表示状態の契約を保つ。
 */
import type { EditorTheme, HostToWebviewMessage } from '../shared/protocol';

/**
 * 編集テーマ制御のthemesとして順序を保つ一覧。
 */
const THEMES: readonly EditorTheme[] = ['light', 'dark'];
/**
 * 編集テーマ制御のcurrent・themeに関する状態または設定。
 */
let currentTheme: EditorTheme = 'dark';

/**
 * 編集テーマ制御のinstall・editor・theme・controllerを処理し、呼び出し側へ結果または副作用を返す。
 * @returns 編集テーマ制御のinstall・editor・theme・controllerが生成する結果。
 */
export function installEditorThemeController(): () => void {
    applyTheme(currentTheme);


    const onMessage = /**
     * 編集テーマ制御のイベントまたはメッセージを受け取り、状態を更新する。
     * @param event - ユーザー操作またはDOMから通知されたイベント。
     * @returns 副作用を完了し、値は返さない。
     */ (event: MessageEvent<HostToWebviewMessage>) => {
            const message = event.data;
            if (message.type !== 'init' && message.type !== 'settingsChanged') return;
            setCurrentTheme(message.settings.editorTheme ?? 'dark');
        };


    const onChange = /**
     * change操作を表示または編集状態へ反映する。
     * @param event - ユーザー操作またはDOMから通知されたイベント。
     * @returns 副作用を完了し、値は返さない。
     */ (event: Event) => {
            const select = event.target instanceof HTMLSelectElement ? event.target : undefined;
            if (!select?.classList.contains('mve-editor-theme-select')) return;
            const theme = select.value as EditorTheme;
            if (!THEMES.includes(theme)) return;
            setCurrentTheme(theme);
        };
    window.addEventListener('message', onMessage);
    document.addEventListener('change', onChange);
    /**
     * イベントでremove・event・listenerを実行する。
     * @returns 副作用を完了し、値は返さない。
     */
    return () => {
        window.removeEventListener('message', onMessage);
        document.removeEventListener('change', onChange);
    };
}

/**
 * 編集テーマ制御の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
 * @param theme - 描画や表示に適用する配色テーマ。
 * @returns 副作用を完了し、値は返さない。
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
 * @returns 副作用を完了し、値は返さない。
 */
function applyTheme(theme: EditorTheme): void {
    document.documentElement.dataset.editorTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.dataset.editorTheme = theme;
    document.body.style.colorScheme = theme;
    document.body.classList.toggle('vscode-light', theme === 'light');
    document.body.classList.toggle('vscode-dark', theme === 'dark');
}
