import { EditorView } from '@codemirror/view';

let installed = false;

/**
 * 表Gridの適用/キャンセル後、クリックやキー処理が完全に終わった次フレームで
 * SourceEditorへフォーカスを戻す。App側のCtrl/Cmd+Z判定は.app内のキー入力だけを
 * 履歴コマンドとして扱うため、body直下オーバーレイから確実に編集領域へ復帰させる。
 */
export function installTableGridEditorFocusBridge(): void {
  if (installed) return;
  installed = true;

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.mve-table-grid-overlay button[data-action]')
      : null;
    if (!button) return;
    const action = button.dataset.action;
    if (action !== 'apply' && action !== 'cancel') return;
    restoreSourceFocusAfterOverlayClose();
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('.mve-table-grid-overlay')
      : null;
    if (!target) return;
    const applies = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
    const cancels = event.key === 'Escape';
    if (applies || cancels) restoreSourceFocusAfterOverlayClose();
  });
}

function restoreSourceFocusAfterOverlayClose(): void {
  window.requestAnimationFrame(() => {
    if (document.querySelector('.mve-table-grid-overlay')) return;
    const editorElement = Array.from(document.querySelectorAll<HTMLElement>('.source-editor .cm-editor'))
      .find((element) => element.getClientRects().length > 0);
    if (!editorElement) return;
    EditorView.findFromDOM(editorElement)?.focus();
  });
}
