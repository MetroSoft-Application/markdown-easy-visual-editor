/**
 * @fileoverview 見出しアウトラインのパネル（折りたたみ可能なツリー、閉じるボタン、幅変更バー）と、ツリーの構築処理。
 * 実行境界は Webview。表示だけを担当し、移動・開閉・並べ替え（右ドラッグ）・幅変更の状態と処理は親から受け取る。
 * 並べ替え中の見た目（ドラッグ元・ドロップ位置）は、親が持つドラッグ状態から決める。
 */
import React from "react";
import type { Messages } from "../../shared/messages";
import type { OutlineItem } from "../../shared/markdown";

/**
 * 右ドラッグで見出しを並べ替える間のポインターと配置状態を保持する。
 */
export interface OutlineDragState {
  /** ドラッグを開始した見出しのアウトライン配列内の位置。 */
  sourceIndex: number;
  /** 操作中のポインターを識別するID。 */
  pointerId: number;
  /** 右ドラッグを開始した画面上のX座標。 */
  startX: number;
  /** 右ドラッグを開始した画面上のY座標。 */
  startY: number;
  /** ドラッグ開始時点のMarkdown本文。 */
  markdown: string;
  /** ドラッグ開始時点のアウトライン項目。 */
  outline: OutlineItem[];
  /** 移動距離がしきい値を超えて並べ替え操作になったかどうか。 */
  dragging: boolean;
  /** 現在のドロップ先見出しのアウトライン配列内の位置。 */
  targetIndex?: number;
  /** ドロップ先見出しの前後どちらへ配置するか。 */
  position?: "before" | "after";
}

/** アウトライン項目の階層と元の一覧位置を保持するツリーノード。 */
export interface OutlineTreeNode {
  /** 対応する平坦なアウトライン項目。 */
  item: OutlineItem;
  /** 元のアウトライン配列における0始まりの位置。 */
  index: number;
  /** 見出しレベルから導出した子見出し。 */
  children: OutlineTreeNode[];
}

/**
 * 平坦な見出し一覧から、レベル順のツリーを線形時間で構築する。
 * @param outline 文書順のアウトライン項目。
 * @returns 元の配列位置を保持したツリーのルート項目。
 */
export function buildOutlineTree(outline: readonly OutlineItem[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const ancestors: OutlineTreeNode[] = [];
  outline.forEach(
    /**
     * 直前の祖先のうち、自分より浅いものの子として追加する。
     * @param item - アウトライン項目。
     * @param index - 元の配列位置。
     */
    (item, index) => {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].item.level >= item.level) ancestors.pop();
      const node: OutlineTreeNode = { item, index, children: [] };
      (ancestors[ancestors.length - 1]?.children ?? roots).push(node);
      ancestors.push(node);
    });
  return roots;
}

/** ツリー項目の操作。 */
interface OutlineTreeHandlers {
  /** 折りたたまれている見出しID。 */
  collapsedIds: ReadonlySet<string>;
  /** 右ドラッグ中の状態。 */
  drag: OutlineDragState | undefined;
  /**
   * 見出しの子を開閉する。
   * @param id - 見出しID。
   */
  onToggle: (id: string) => void;
  /** 開閉ボタン上の右クリックで、並べ替えの開始判定を取り消す。 */
  onDisclosureContextMenu: () => void;
  /**
   * 見出しの位置へ移動する。
   * @param offset - 見出しの文書内オフセット。
   */
  onNavigate: (offset: number) => void;
  /**
   * 右ドラッグの開始を判定する。
   * @param event - ポインターイベント。
   * @param index - 見出しの配列位置。
   */
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>, index: number) => void;
  /**
   * 右ドラッグ中のドロップ先を更新する。
   * @param event - ポインターイベント。
   */
  onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  /**
   * 右ドラッグを終える。
   * @param event - ポインターイベント。
   * @param cancelled - 取り消された場合はtrue。
   */
  onDragEnd: (event: React.PointerEvent<HTMLButtonElement>, cancelled?: boolean) => void;
}

/**
 * アウトラインツリーの各階層を再帰的に描画する。
 * @param nodes - この階層のノード。
 * @param depth - 階層の深さ（0始まり）。インデント幅に使う。
 * @param handlers - 開閉・移動・並べ替えの状態と処理。
 * @returns リスト項目の配列。
 */
function renderOutlineNodes(
  nodes: readonly OutlineTreeNode[],
  depth: number,
  handlers: OutlineTreeHandlers,
): React.JSX.Element[] {
  const { collapsedIds, drag } = handlers;
  return nodes.map(
    /**
     * 見出し1件と、その子のリストを描画する。
     * @param node - ツリーノード。
     * @returns リスト項目。
     */
    ({ item, index, children }) => {
      const hasChildren = children.length > 0;
      const collapsed = collapsedIds.has(item.id);
      const childListId = `outline-children-${index}`;
      const isDragSource = drag?.dragging && drag.sourceIndex === index;
      const isDropTarget = drag?.targetIndex === index && drag.position;
      return (
        <li
          className={hasChildren ? "outline-node outline-node-parent" : "outline-node"}
          data-outline-level={item.level}
          key={`${item.offset}-${item.id}`}
        >
          <div
            className="outline-row"
            style={{
              "--outline-row-inset": depth === 0 && !hasChildren ? "0px" : `${18 + depth * 22}px`,
            } as React.CSSProperties}
          >
            {hasChildren ? (
              <button
                type="button"
                className="outline-disclosure"
                aria-label={item.text}
                aria-expanded={!collapsed}
                aria-controls={childListId}
                onClick={
                  /**
                   * 左クリックで開閉する。見出しへの移動は起こさない。
                   * @param event - クリックイベント。
                   */
                  (event) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    handlers.onToggle(item.id);
                  }
                }
                onContextMenu={
                  /**
                   * 開閉ボタン上ではセクションリンクのメニューを出さない。
                   * @param event - コンテキストメニューイベント。
                   */
                  (event) => {
                    handlers.onDisclosureContextMenu();
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }
              >
                <span className="outline-disclosure-icon" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className={
                `outline-item${isDragSource ? " outline-drag-source" : ""}` +
                `${isDropTarget ? ` outline-drop-${drag?.position}` : ""}`
              }
              data-outline-index={index}
              data-section-id={item.id}
              data-dragging={isDragSource ? "true" : undefined}
              onClick={
                /**
                 * 左クリックで見出しへ移動する。
                 * @param event - クリックイベント。
                 */
                (event) => {
                  if (event.button === 0) handlers.onNavigate(item.offset);
                }
              }
              onPointerDown={
                /**
                 * 右ドラッグの開始を判定する。
                 * @param event - ポインターイベント。
                 */
                (event) => handlers.onDragStart(event, index)
              }
              onPointerMove={handlers.onDragMove}
              onPointerUp={handlers.onDragEnd}
              onPointerCancel={
                /**
                 * 中断されたドラッグを取り消す。
                 * @param event - ポインターイベント。
                 */
                (event) => handlers.onDragEnd(event, true)
              }
            >
              {item.text}
            </button>
          </div>
          {hasChildren ? (
            <ul className="outline-children" id={childListId} hidden={collapsed}>
              {renderOutlineNodes(children, depth + 1, handlers)}
            </ul>
          ) : null}
        </li>
      );
    });
}

/** アウトラインパネルの入力。 */
interface OutlinePanelProps extends OutlineTreeHandlers {
  /** 表示文言。 */
  messages: Messages;
  /** パネルの幅（ピクセル）。 */
  width: number;
  /** 表示する見出しツリー。空なら「見出しなし」を表示する。 */
  tree: readonly OutlineTreeNode[];
  /** パネルを閉じる。 */
  onClose: () => void;
  /**
   * 幅変更バーのドラッグを開始する。
   * @param event - ポインターイベント。
   */
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  /**
   * キーボードで幅を変える。
   * @param delta - 変化量（ピクセル）。
   */
  onResizeBy: (delta: number) => void;
}

/**
 * アウトラインパネルと幅変更バー。幅変更バーは左右矢印キーで10ピクセルずつ変更できる。
 * 残りの入力（collapsedIds、drag、onToggle、onDisclosureContextMenu、onNavigate、onDragStart、onDragMove、onDragEnd）は、
 * ツリー項目の開閉・移動・並べ替えの状態と処理としてそのまま各項目へ渡す。
 * @param messages - 表示文言。
 * @param width - パネルの幅（ピクセル）。
 * @param tree - 表示する見出しツリー。空なら「見出しなし」を表示する。
 * @param onClose - パネルを閉じる処理。
 * @param onResizeStart - 幅変更バーのドラッグを開始する処理。
 * @param onResizeBy - キーボードで幅を変える処理。
 * @returns パネルと幅変更バーのフラグメント。
 */
export function OutlinePanel({
  messages,
  width,
  tree,
  onClose,
  onResizeStart,
  onResizeBy,
  ...handlers
}: OutlinePanelProps): React.JSX.Element {
  return (
    <>
      <aside className="outline-panel" style={{ flexBasis: `${width}px` }} aria-label={messages.app.outline}>
        <div className="outline-header">
          <h2>{messages.app.outline}</h2>
          <button
            type="button"
            className="panel-close-button"
            title={messages.app.hideOutline}
            aria-label={messages.app.hideOutline}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {tree.length ? (
          <nav aria-label={messages.app.outline}>
            <ul className="outline-tree">{renderOutlineNodes(tree, 0, handlers)}</ul>
          </nav>
        ) : (
          <p>{messages.app.noHeadings}</p>
        )}
      </aside>
      <div
        className="outline-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={messages.app.outlineWidth}
        aria-valuemin={160}
        aria-valuemax={420}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={
          /**
           * 左右矢印キーで幅を変える。
           * @param event - キー入力イベント。
           */
          (event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") onResizeBy(event.key === "ArrowLeft" ? -10 : 10);
          }
        }
      />
    </>
  );
}
