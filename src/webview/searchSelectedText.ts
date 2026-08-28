import { EditorView } from '@codemirror/view';

let installed = false;

/**
 * 検索パネルを開いた瞬間に、ソースエディターで選択中の文字列を検索欄へ転送する。
 * 検索パネルが既に開いている間は既存の検索語を上書きしない。
 */
export function installSelectedTextSearchTransfer(): void {
  if (installed) return;
  installed = true;

  // Reactの閉じる→開くが同じMutationObserver通知にまとまる場合があるため、
  // 可視/非可視のbooleanではなく実際のDOM要素の世代を追跡する。
  let currentPanel: HTMLElement | null = document.querySelector<HTMLElement>('.search-panel');

  const syncPanel = (): void => {
    const panel = document.querySelector<HTMLElement>('.search-panel');
    if (panel === currentPanel) return;

    currentPanel = panel;
    if (panel) transferSelectionToSearch(panel);
  };

  const start = (): void => {
    syncPanel();
    const observer = new MutationObserver(syncPanel);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    queueMicrotask(start);
  }
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
  if (selection.empty) return;

  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  if (!selectedText) return;

  // 検索欄は<input type="text">なので改行を保持できない。複数行選択を勝手に連結しない。
  if (/\r|\n/.test(selectedText)) return;

  const input = panel.querySelector<HTMLInputElement>('input:first-of-type');
  if (!input || input.value === selectedText) return;

  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) return;

  valueSetter.call(input, selectedText);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 現在レイアウト上に表示されているソースエディターのDOMを返す。 */
function findVisibleEditorElement(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
    .find((element) => element.getClientRects().length > 0);
}
