/**
 * @fileoverview Webview のリボンで使う「本体＋▾」の分割ボタンと、その一覧（縦の一覧または格子）を提供する。
 * 本体は最後に選んだもの（本体の下に小さく表示）を 1 回の操作で実行し、「▾」は一覧を開いて選んだものをその場で実行する。
 * リボン本体（.ribbon-content）は縦方向のはみ出しを隠すため、一覧は document.body へ描画し、position: fixed でボタンの位置から配置する。
 * 不変条件: 一覧は画面内に収める（右端は左へずらし、下に余裕がなければ上へ開き、高さは見えている範囲に収めてスクロールさせる）。
 * 一覧を開いている間だけ document と window にリスナーを登録し、閉じるとき（アンマウントを含む）に必ず解除する。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 一覧の 1 項目。 */
export interface RibbonSplitMenuItem {
  /** React の key と項目の識別に使う、一覧の中で重複しない値。 */
  readonly key: string;
  /** 一覧に表示する文字列。 */
  readonly label: string;
  /** 読み上げ名。未指定なら label を読み上げる。 */
  readonly ariaLabel?: string;
}

/** RibbonSplitMenuButton の入力。 */
export interface RibbonSplitMenuButtonProps {
  /** 本体に表示する名前（例: コードブロック）。 */
  readonly label: string;
  /** 本体の下に小さく表示する、本体を押したときに入るもの（例: プレーンテキスト）。 */
  readonly current: string;
  /** current を大きく表示する場合は true（絵文字など、9px では見分けられないもの）。既定は false。 */
  readonly largeCurrent?: boolean;
  /** 「▾」の読み上げ名とツールチップ、および一覧の読み上げ名（例: コードブロックの言語を選ぶ）。 */
  readonly chooseLabel: string;
  /** 一覧の項目。並び順が表示順。 */
  readonly items: readonly RibbonSplitMenuItem[];
  /** 本体に入るものの位置。一覧で ✓ を付け、「▾」で開いたときに最初にフォーカスする。見つからない場合は -1。 */
  readonly checkedIndex: number;
  /** 一覧の形。list は縦の一覧、grid は columns 列の格子。 */
  readonly layout: "list" | "grid";
  /** 格子の列数。layout が grid のときだけ使う。既定は 6。 */
  readonly columns?: number;
  /** 編集できない場合は true。本体と「▾」の両方を無効にし、開いている一覧は閉じる。 */
  readonly disabled: boolean;
  /** 本体を押したときの処理。 */
  readonly onMain: () => void;
  /** 一覧で項目を選んだときの処理。一覧を閉じてから呼ぶ。 */
  readonly onPick: (index: number) => void;
}

/** 一覧と画面の端の間に空ける余白（px）。 */
const VIEWPORT_MARGIN = 4;
/** 下に開くために最低限ほしい高さ（px）。これより狭く、上の方が広ければ上へ開く。 */
const MIN_HEIGHT_BELOW = 160;

/**
 * 「本体＋▾」の分割ボタン。
 * キー操作: 「▾」で Enter・Space・↓ は選択中（なければ先頭）、↑ は末尾へフォーカスして開く。一覧の中は ↑↓（格子は ↑↓←→）、
 * Home・End、頭文字（縦の一覧のみ）で移動し、Enter・Space で選ぶ。Tab・Shift+Tab は一覧を閉じ、リボンの中で「▾」の次・前の部品へ移る
 * （一覧は document.body に描画しているため、ブラウザーの既定の移動に任せるとリボンの外へ外れる）。
 * フォーカスの戻り先: 項目を選んだときと Esc では、一覧を開く直前にフォーカスがあった場所へ戻す。リボンはマウス操作で
 * ソースエディターのフォーカスを奪わないため、マウスで選んだ場合はソースエディターへ戻り、続けて入力できる。
 * キーボードで「▾」から開いた場合は「▾」へ戻る。
 * 閉じる条件: 項目を選んだとき、Esc、Tab、一覧と分割ボタンの外を押したとき、Webview がフォーカスを失ったとき、画面の大きさの変更、
 * 分割ボタンの位置を動かすスクロール（リボンの横スクロールを含む）、無効になったとき、アンマウント（タブの切替やリボンの折りたたみ）。
 * @param props - 表示名、一覧の項目、状態、処理。
 * @returns 分割ボタンと、開いている間の一覧。
 */
export function RibbonSplitMenuButton(props: RibbonSplitMenuButtonProps): React.JSX.Element {
  const {
    label,
    current,
    largeCurrent = false,
    chooseLabel,
    items,
    checkedIndex,
    layout,
    columns = 6,
    disabled,
    onMain,
    onPick,
  } = props;
  /** 開いているときは最初にフォーカスする項目の位置。閉じているときは undefined。 */
  const [openFocus, setOpenFocus] = useState<number | undefined>();
  /** 一覧の位置と最大の高さ（px）。開いた直後は undefined で、大きさを測ってから決める。 */
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | undefined>();
  /** 分割ボタン全体（本体と「▾」）。一覧の配置の基準と、外のクリックの判定に使う。 */
  const wrapperRef = useRef<HTMLSpanElement>(null);
  /** 「▾」。フォーカスの戻り先の代わりと、Tab 移動の起点に使う。 */
  const caretRef = useRef<HTMLButtonElement>(null);
  /** 一覧の要素（document.body へ描画する）。 */
  const popupRef = useRef<HTMLDivElement>(null);
  /** 一覧を開く直前にフォーカスがあった要素。項目を選んだときと Esc で、ここへフォーカスを戻す。 */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** 一覧を表示しているか。無効のときは開かない。 */
  const open = openFocus !== undefined && !disabled;
  /** 矢印キーの上下で移動する項目の数（格子は列数、縦の一覧は 1）。 */
  const columnCount = layout === "grid" ? columns : 1;

  /**
   * 一覧を閉じる。
   * @param restoreFocus - 一覧を開く直前にフォーカスがあった場所へ戻す場合は true（項目の選択と Esc）。
   * 戻り先が文書から外れている、または body の場合は「▾」へ戻す。
   */
  const close = (restoreFocus: boolean): void => {
    setOpenFocus(undefined);
    setPlacement(undefined);
    if (!restoreFocus) return;
    const target = returnFocusRef.current;
    if (target && target.isConnected && target !== document.body) target.focus();
    else caretRef.current?.focus();
  };

  /**
   * 一覧を開く。開く直前のフォーカスの位置を覚える（一覧の中の要素は覚えない）。
   * @param focusIndex - 最初にフォーカスする項目の位置。負の値は末尾。
   */
  const openAt = (focusIndex: number): void => {
    if (items.length === 0) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement && !popupRef.current?.contains(active) ? active : null;
    setPlacement(undefined);
    setOpenFocus(focusIndex < 0 ? items.length - 1 : Math.min(focusIndex, items.length - 1));
  };

  /**
   * Tab・Shift+Tab で、リボンの中で「▾」の次・前のフォーカスできる部品へ移る。見つからなければ「▾」に留まる。
   * @param backward - Shift+Tab なら true。
   */
  const moveFocusFromCaret = (backward: boolean): void => {
    const caret = caretRef.current;
    const ribbon = caret?.closest(".ribbon");
    if (!caret || !ribbon) return;
    const focusable = [...ribbon.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)")];
    const index = focusable.indexOf(caret);
    (focusable[index + (backward ? -1 : 1)] ?? caret).focus();
  };

  useEffect(
    /** 無効になったら一覧を閉じ、再び有効になったときに勝手に開き直さないようにする。 */
    () => {
      if (disabled) {
        setOpenFocus(undefined);
        setPlacement(undefined);
      }
    },
    [disabled],
  );

  useLayoutEffect(
    /**
     * 開いた直後に、一覧の大きさとボタンの位置から配置を決める（描画前に決め、ちらつかせない）。
     * 右端に収まらなければ左へずらし、ボタン自体が画面の端にかかっていても一覧は画面内に収める。
     * 下に MIN_HEIGHT_BELOW 未満しかなく上の方が広ければ上へ開き、高さは見えている範囲に収める。
     */
    () => {
      if (!open || placement || !popupRef.current || !wrapperRef.current) return;
      const anchor = wrapperRef.current.getBoundingClientRect();
      const natural = popupRef.current.getBoundingClientRect();
      let left = anchor.left;
      if (left + natural.width > window.innerWidth - VIEWPORT_MARGIN) left = anchor.right - natural.width;
      left = Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - natural.width));
      const below = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN - 2;
      const above = anchor.top - VIEWPORT_MARGIN - 2;
      if (below >= Math.min(natural.height, MIN_HEIGHT_BELOW) || below >= above) {
        setPlacement({ left, top: anchor.bottom + 2, maxHeight: below });
      } else {
        setPlacement({ left, top: anchor.top - 2 - Math.min(natural.height, above), maxHeight: above });
      }
    },
    [open, placement],
  );

  useEffect(
    /** 配置が決まったら、最初の項目へフォーカスを移す。 */
    () => {
      if (!open || !placement || openFocus === undefined) return;
      popupRef.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitemradio']")[openFocus]?.focus();
    },
    [open, placement, openFocus],
  );

  useEffect(
    /**
     * 開いている間だけ、閉じる条件のリスナーを登録する。
     * @returns 登録したリスナーを解除する関数。閉じているときは何も登録しない。
     */
    () => {
      if (!open) return undefined;
      /** 一覧と分割ボタンの外を押したら閉じる。 */
      const handlePointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null;
        if (target && (popupRef.current?.contains(target) || wrapperRef.current?.contains(target))) return;
        close(false);
      };
      /**
       * 分割ボタンの位置を動かすスクロール（リボンの横スクロールや文書全体のスクロール）では、一覧がボタンから離れるため閉じる。
       * ソースエディターやプレビューなど、分割ボタンを含まない領域のスクロール（入力後の自動スクロールを含む）では閉じない。
       */
      const handleScroll = (event: Event): void => {
        const target = event.target;
        if (target instanceof Document || target === window) {
          close(false);
          return;
        }
        if (target instanceof Node && wrapperRef.current && target.contains(wrapperRef.current)) close(false);
      };
      /** 画面の大きさの変更と、Webview がフォーカスを失ったときに閉じる。 */
      const handleDismiss = (): void => close(false);
      document.addEventListener("pointerdown", handlePointerDown, true);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleDismiss);
      window.addEventListener("blur", handleDismiss);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown, true);
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleDismiss);
        window.removeEventListener("blur", handleDismiss);
      };
    },
    [open],
  );

  /**
   * 「▾」のキー操作。↓ は選択中（なければ先頭）、↑ は末尾へフォーカスして開く。Enter・Space はクリックとして開く。
   * @param event - 「▾」のキー入力イベント。
   */
  const handleCaretKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAt(Math.max(0, checkedIndex));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(-1);
    }
  };

  /**
   * 一覧の中のキー操作。縦の一覧は ↑↓、格子は ↑↓←→ で移動し、Home・End、頭文字（縦の一覧のみ）にも対応する。
   * @param event - 一覧のキー入力イベント。
   */
  const handlePopupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(popupRef.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitemradio']") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    /**
     * 指定の位置（端では反対側へ回り込む）の項目へフォーカスを移す。
     * @param next - 移動先の位置。
     */
    const move = (next: number): void => {
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        event.preventDefault();
        close(false);
        moveFocusFromCaret(event.shiftKey);
        return;
      case "ArrowDown":
        move(index + columnCount);
        return;
      case "ArrowUp":
        move(index - columnCount);
        return;
      case "ArrowRight":
        if (layout === "grid") move(index + 1);
        return;
      case "ArrowLeft":
        if (layout === "grid") move(index - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(buttons.length - 1);
        return;
      default:
        if (layout === "list" && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const key = event.key.toLocaleLowerCase();
          for (let step = 1; step <= buttons.length; step += 1) {
            const candidate = (index + step) % buttons.length;
            if (items[candidate]?.label.toLocaleLowerCase().startsWith(key)) {
              move(candidate);
              return;
            }
          }
        }
    }
  };

  /**
   * 開いている間の一覧。リボン本体のはみ出しの制限を受けないよう document.body へ描画する。
   * 配置が決まるまでは見えない状態で描画し、大きさを測ってから位置を決める。
   */
  const popup = open
    ? createPortal(
        <div
          ref={popupRef}
          className={`ribbon-popup ribbon-popup-${layout}`}
          role="menu"
          aria-label={chooseLabel}
          style={
            placement
              ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight, gridTemplateColumns: layout === "grid" ? `repeat(${columnCount}, 32px)` : undefined }
              : { left: 0, top: 0, visibility: "hidden", gridTemplateColumns: layout === "grid" ? `repeat(${columnCount}, 32px)` : undefined }
          }
          onKeyDown={handlePopupKeyDown}
        >
          {items.map(
            /**
             * 一覧の 1 項目を作る。選ぶと一覧を閉じて「▾」へフォーカスを戻してから、選んだときの処理を呼ぶ。
             * @param item - 項目。
             * @param index - 項目の位置。
             * @returns 項目のボタン。
             */
            (item, index) => (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={index === checkedIndex}
                aria-label={item.ariaLabel}
                title={layout === "grid" ? item.ariaLabel ?? item.label : undefined}
                tabIndex={-1}
                onClick={
                  /** 一覧を閉じてから選んだものを実行する。 */
                  () => {
                    close(true);
                    onPick(index);
                  }
                }
              >
                {item.label}
              </button>
            ),
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <span ref={wrapperRef} className={`ribbon-split ${open ? "open" : ""}`}>
      <button
        type="button"
        className="ribbon-tool ribbon-split-main"
        disabled={disabled}
        title={`${label}: ${current}`}
        onClick={onMain}
      >
        <span>{label}</span>
        <small className={largeCurrent ? "ribbon-split-current-large" : undefined}>{current}</small>
      </button>
      <button
        ref={caretRef}
        type="button"
        className="ribbon-tool ribbon-split-caret"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={chooseLabel}
        title={chooseLabel}
        disabled={disabled}
        onClick={
          /** 一覧を開閉する。開くときは選択中（なければ先頭）へフォーカスする。 */
          () => (open ? close(false) : openAt(Math.max(0, checkedIndex)))
        }
        onKeyDown={handleCaretKeyDown}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {popup}
    </span>
  );
}
