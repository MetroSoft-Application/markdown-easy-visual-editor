import type { EditorTheme, HostToWebviewMessage } from '../shared/protocol';

const THEMES: readonly EditorTheme[] = ['light', 'dark'];
let currentTheme: EditorTheme = 'dark';

/**
 * ホストから届くエディターテーマ設定を画面とリボンへ反映する。
 * @returns 破棄時に呼び出すクリーンアップ関数。
 */
export function installEditorThemeController(): () => void {
  applyTheme(currentTheme);
  const onMessage = (event: MessageEvent<HostToWebviewMessage>) => {
    const message = event.data;
    if (message.type !== 'init' && message.type !== 'settingsChanged') return;
    setCurrentTheme(message.settings.editorTheme ?? 'dark');
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/** 現在テーマを画面へ反映し、表示中のリボン選択値も更新する。 */
function setCurrentTheme(theme: EditorTheme): void {
  currentTheme = THEMES.includes(theme) ? theme : 'dark';
  applyTheme(currentTheme);
  const select = document.querySelector<HTMLSelectElement>('.mve-editor-theme-select');
  if (select && select.value !== currentTheme) select.value = currentTheme;
}

/** html要素へテーマ属性とcolor-schemeを設定する。 */
function applyTheme(theme: EditorTheme): void {
  document.documentElement.dataset.editorTheme = theme;
  document.documentElement.style.colorScheme = theme;
}
