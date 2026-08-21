import type { EditorTheme, HostToWebviewMessage } from '../shared/protocol';
import { sharedVsCodeApi } from './vscodeApi';

const THEMES: readonly EditorTheme[] = ['light', 'dark'];
let currentTheme: EditorTheme = 'dark';
let observer: MutationObserver | undefined;

/**
 * リボンへエディターテーマ選択UIを追加し、ホスト設定と同期する。
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

  observer = new MutationObserver(() => ensureRibbonControl());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(() => ensureRibbonControl());

  return () => {
    window.removeEventListener('message', onMessage);
    observer?.disconnect();
    observer = undefined;
  };
}

/** 現在テーマを画面へ反映し、リボン選択値も更新する。 */
function setCurrentTheme(theme: EditorTheme): void {
  currentTheme = THEMES.includes(theme) ? theme : 'dark';
  applyTheme(currentTheme);
  const select = document.querySelector<HTMLSelectElement>('.mve-theme-control select');
  if (select && select.value !== currentTheme) select.value = currentTheme;
}

/** html要素へテーマ属性とcolor-schemeを設定する。 */
function applyTheme(theme: EditorTheme): void {
  document.documentElement.dataset.editorTheme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** リボンタブ行へテーマ選択欄がなければ追加する。 */
function ensureRibbonControl(): void {
  const tabs = document.querySelector<HTMLElement>('.ribbon-tabs');
  if (!tabs || tabs.querySelector('.mve-theme-control')) return;

  const label = document.createElement('label');
  label.className = 'mve-theme-control';
  const language = document.documentElement.lang.toLowerCase();
  const japanese = language === 'ja' || language.startsWith('ja-');
  const caption = document.createElement('span');
  caption.textContent = japanese ? 'テーマ' : 'Theme';
  label.appendChild(caption);

  const select = document.createElement('select');
  select.setAttribute('aria-label', caption.textContent ?? 'Theme');
  select.title = japanese ? 'エディターテーマ' : 'Editor theme';
  for (const theme of THEMES) {
    const option = document.createElement('option');
    option.value = theme;
    option.textContent = theme === 'light'
      ? (japanese ? 'ライト' : 'Light')
      : (japanese ? 'ダーク' : 'Dark');
    select.appendChild(option);
  }
  select.value = currentTheme;
  select.addEventListener('change', () => {
    const theme = select.value as EditorTheme;
    if (!THEMES.includes(theme)) return;
    setCurrentTheme(theme);
    sharedVsCodeApi.postMessage({ type: 'setEditorTheme', theme });
  });
  label.appendChild(select);

  const spacer = tabs.querySelector('.ribbon-spacer');
  if (spacer) spacer.insertAdjacentElement('afterend', label);
  else tabs.appendChild(label);
}
