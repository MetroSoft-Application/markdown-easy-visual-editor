/**
 * @fileoverview アウトラインの右ドラッグによる見出しセクションの並べ替えを扱う React フック（Webview）。
 * 右ボタンで押した見出しを一定距離以上動かすと並べ替え操作になり、離した位置の前後へセクションを移動する。
 * 動かさずに離した場合は、セクションリンクのメニューを開く（右クリックと同じ）。
 * 不変条件: プレビューが最新本文を描画済みのときだけ開始し、確定時に本文が開始時から変わっていれば適用しない
 * （古い見出し位置で本文を壊さないため）。ドラッグ中は body に mve-dragging-outline クラスを付け、終了時に必ず外す。
 */
import { useRef, useState } from "react";
import type React from "react";
import {
  canMoveOutlineSection,
  isOutlineEmptyParentTarget,
  moveOutlineSection,
  type OutlineItem,
} from "../../shared/markdown";
import type { OutlineDragState } from "./OutlinePanel";
import type { SectionLinkMenuState } from "./AppPanels";

/** アウトライン項目をドラッグと判定する最小移動距離（CSS px）。 */
const OUTLINE_DRAG_THRESHOLD_PX = 6;

/** useOutlineReorder の入力。 */
export interface OutlineReorderOptions {
  /** 本文を編集できる表示構成ならtrue。falseなら並べ替えを始めない。 */
  editingEnabled: boolean;
  /** 現在の本文。 */
  markdown: string;
  /** プレビューが描画済みの本文。markdown と異なる間は並べ替えを始めない。 */
  previewMarkdown: string;
  /** 現在のアウトライン。 */
  outline: readonly OutlineItem[];
  /**
   * 確定直前の最新本文を返す。
   * @returns 現在の本文。
   */
  getText: () => string;
  /** 本文変更の前に表示位置の復元を準備する。 */
  prepareLayoutRestore: () => void;
  /**
   * 並べ替え後の本文を反映する。
   * @param text - 並べ替え後の本文。
   */
  applyMarkdown: (text: string) => void;
  /**
   * セクションリンクのメニューを開く。
   * @param menu - 対象の見出しと表示位置。
   */
  openSectionLinkMenu: (menu: SectionLinkMenuState) => void;
}

/**
 * アウトラインの右ドラッグによる並べ替えの状態と処理を提供する。
 * @param options - 編集可否、本文、アウトライン、本文反映とメニュー表示の処理。
 * @returns 描画用のドラッグ状態、コンテキストメニュー判定に使う ref、ポインター操作の処理。
 */
export function useOutlineReorder(options: OutlineReorderOptions) {
  const outlineDragRef = useRef<OutlineDragState | undefined>(undefined);
  const [outlineDrag, setOutlineDrag] = useState<OutlineDragState | undefined>(undefined);
  /** 並べ替え操作の直後に届くコンテキストメニューを、メニュー表示として扱わないための印。 */
  const skipOutlineContextMenuRef = useRef(false);
  /** 三角形上から始まった右ポインター操作を見出し名の右クリックと区別する。 */
  const outlineDisclosureRightPointerRef = useRef(false);

  /**
   * 右ドラッグ中のポインター位置から、ドロップ先の見出しと前後位置を更新する。
   * 移動距離がしきい値未満の間は並べ替え操作として扱わない。移動できない見出しの上ではドロップ先を外す。
   * @param event - ドラッグ中の目次項目の移動先を更新するpointer event。
   */
  function updateOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
  ): void {
    const current = outlineDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );
    if (!current.dragging && distance < OUTLINE_DRAG_THRESHOLD_PX) return;

    if (!current.dragging) document.body.classList.add("mve-dragging-outline");
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>("button[data-outline-index]");
    const targetIndex = element
      ? Number(element.dataset.outlineIndex)
      : Number.NaN;
    let nextTargetIndex: number | undefined;
    let position: "before" | "after" | undefined;
    if (
      element &&
      Number.isInteger(targetIndex) &&
      canMoveOutlineSection(current.outline, current.sourceIndex, targetIndex)
    ) {
      nextTargetIndex = targetIndex;
      if (
        isOutlineEmptyParentTarget(
          current.outline,
          current.sourceIndex,
          targetIndex,
        )
      ) {
        position = "after";
      } else {
        const bounds = element.getBoundingClientRect();
        position =
          event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      }
    }
    const next: OutlineDragState = {
      ...current,
      dragging: true,
      targetIndex: nextTargetIndex,
      position,
    };
    outlineDragRef.current = next;
    if (
      current.dragging !== next.dragging ||
      current.targetIndex !== next.targetIndex ||
      current.position !== next.position
    ) {
      setOutlineDrag(next);
    }
    event.preventDefault();
  }

  /**
   * 右ドラッグを終える。並べ替えとして有効なら本文へ反映し、動かさずに離した場合はセクションリンクのメニューを開く。
   * @param event - 目次項目のdragを確定またはcancelするpointer event。
   * @param cancelled - ポインターが中断された場合はtrue。本文を変更せず、メニューも開かない。
   */
  function finishOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    cancelled = false,
  ): void {
    const current = outlineDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragging) event.preventDefault();
    skipOutlineContextMenuRef.current = true;
    if (
      !cancelled &&
      options.editingEnabled &&
      current.dragging &&
      current.targetIndex !== undefined &&
      current.position &&
      options.getText() === current.markdown
    ) {
      const nextText = moveOutlineSection(
        current.markdown,
        current.outline,
        current.sourceIndex,
        current.targetIndex,
        current.position,
      );
      if (nextText && nextText !== current.markdown) {
        options.prepareLayoutRestore();
        options.applyMarkdown(nextText);
      }
    }
    outlineDragRef.current = undefined;
    setOutlineDrag(undefined);
    document.body.classList.remove("mve-dragging-outline");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && !current.dragging) {
      const item = current.outline[current.sourceIndex];
      if (item)
        options.openSectionLinkMenu({
          id: item.id,
          text: item.text,
          x: event.clientX,
          y: event.clientY,
        });
    }
  }

  /**
   * アウトライン項目の右ドラッグを開始する。
   * @param event - 指定した目次項目のdragを開始するpointer event。
   * @param sourceIndex ドラッグ元となるアウトライン項目の0始まりインデックス。
   */
  function beginOutlineDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    sourceIndex: number,
  ): void {
    if (event.button === 2) skipOutlineContextMenuRef.current = false;
    if (event.button !== 2 || !options.editingEnabled) return;
    // プレビューが遅延中の古いオフセットで本文を壊さないよう、最新描画済みのときだけ開始する。
    if (options.previewMarkdown !== options.markdown) return;
    const next: OutlineDragState = {
      sourceIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      markdown: options.markdown,
      outline: [...options.outline],
      dragging: false,
    };
    outlineDragRef.current = next;
    setOutlineDrag(next);
    // 右ボタン押下ではブラウザが通常フォーカスを移さないため、ドラッグ後のUndo/RedoをWebviewへ届ける。
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  /**
   * 開閉三角形から始まった右ポインター操作を識別する。
   * @param event アプリ領域に届いたポインター押下イベント。
   * @returns 右ポインター操作の開始位置を記録する副作用。
   */
  function trackOutlineDisclosurePointer(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    outlineDisclosureRightPointerRef.current =
      event.button === 2 &&
      event.target instanceof Element &&
      event.target.closest(".outline-disclosure") !== null;
  }

  return {
    outlineDrag,
    outlineDragRef,
    skipOutlineContextMenuRef,
    outlineDisclosureRightPointerRef,
    beginOutlineDrag,
    updateOutlineDrag,
    finishOutlineDrag,
    trackOutlineDisclosurePointer,
  };
}
