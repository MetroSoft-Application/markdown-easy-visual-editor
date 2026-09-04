import type { EditorTheme, HostToWebviewMessage } from '../shared/protocol';

const THEMES: readonly EditorTheme[] = ['light', 'dark'];
let currentTheme: EditorTheme = 'dark';

/**
 * ホストから届くエディターテーマ設定を画面とリボンへ反映し、リボン操作は保存応答を待たず即時適用する。
 * @returns 破棄時に呼び出すクリーンアップ関数。
 */
export function installEditorThemeController(): () => void {
    applyTheme(currentTheme);
    const onMessage = (event: MessageEvent<HostToWebviewMessage>) => {
        const message = event.data;
        if (message.type !== 'init' && message.type !== 'settingsChanged') return;
        setCurrentTheme(message.settings.editorTheme ?? 'dark');
    };
    const onChange = (event: Event) => {
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

/** 現在テーマを画面へ反映し、表示中のリボン選択値も更新する。 */
function setCurrentTheme(theme: EditorTheme): void {
    currentTheme = THEMES.includes(theme) ? theme : 'dark';
    applyTheme(currentTheme);
    const select = document.querySelector<HTMLSelectElement>('.mve-editor-theme-select');
    if (select && select.value !== currentTheme) select.value = currentTheme;
}

/**
 * html/bodyへ独自テーマ状態を設定し、Webview内でVS Codeテーマクラスを参照する処理も同じlight/darkへ揃える。
 * 高コントラスト状態はアクセシビリティ情報として保持する。
 */
function applyTheme(theme: EditorTheme): void {
    document.documentElement.dataset.editorTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.dataset.editorTheme = theme;
    document.body.style.colorScheme = theme;
    document.body.classList.toggle('vscode-light', theme === 'light');
    document.body.classList.toggle('vscode-dark', theme === 'dark');
}
