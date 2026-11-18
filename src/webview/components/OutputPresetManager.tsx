/**
 * @fileoverview ユーザーが保存した出力設定の選択欄と、印刷設定パネル上部の操作（保存・名前変更・削除・JSON共有）。
 * あらかじめ用意した設定は持たず、一覧に出るのはユーザーが保存したものだけ。
 * 実行境界は Webview。表示するプリセットと変更有無は親が resolveOutputPresetState で決めた値を受け取り、
 * リボンとパネルで同じ表示になるようにする。永続化・適用・名前の一意性の最終判定は Extension Host が行う。
 * 選択欄で選んだ時点で適用する（別の「適用」操作は設けない）。
 */
import React, { useEffect, useRef, useState } from "react";
import { normalizeOutputPresetName, type OutputPreset } from "../../shared/outputPresets";
import type { Messages } from "../../shared/messages";

/** プリセット選択欄の入力。 */
export interface OutputPresetSelectProps {
  /** 表示文言。 */
  messages: Messages;
  /** ユーザーが保存した設定の一覧。 */
  presets: readonly OutputPreset[];
  /** 表示するプリセットID。空文字列なら「（未保存）」を表示する。 */
  presetId: string;
  /**
   * プリセットを選んだときに呼ぶ。空文字列（カスタム）は選び直せないため通知しない。
   * @param id - 選ばれたプリセットID。
   */
  onApply: (id: string) => void;
  /** select要素のclass。リボンとパネルで幅だけを変える。 */
  className?: string;
}

/**
 * ユーザーが保存した設定の選択欄。リボンと印刷設定パネルで共有する。
 * @param messages - 表示文言。
 * @param presets - ユーザーが保存した設定の一覧。
 * @param presetId - 表示するプリセットID。空文字列なら「（未保存）」を表示する。
 * @param onApply - プリセットを選んだときの適用処理。
 * @param className - select要素のclass。
 * @returns プリセットのselect要素。
 */
export function OutputPresetSelect({
  messages,
  presets,
  presetId,
  onApply,
  className,
}: OutputPresetSelectProps): React.JSX.Element {
  const labels = messages.ribbon.labels;
  return (
    <select
      className={className}
      aria-label={labels.outputPreset}
      value={presetId}
      onChange={
        /**
         * 選んだプリセットをすぐに適用する。
         * @param event - 選択欄の変更イベント。
         */
        (event) => {
          if (event.currentTarget.value) onApply(event.currentTarget.value);
        }
      }
    >
      {/* どのプリセットにも属さない設定のときだけ表示し、選び直しの対象にはしない。 */}
      {presetId === "" && <option value="" disabled>{labels.customPreset}</option>}
      {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select>
  );
}

/** 印刷設定パネル上部のプリセット操作の入力。 */
export interface OutputPresetManagerProps {
  /** 表示文言。 */
  messages: Messages;
  /** ユーザーが保存した設定の一覧。 */
  presets: readonly OutputPreset[];
  /** 表示するプリセットID。空文字列はどのプリセットにも属さない設定。 */
  presetId: string;
  /** presetIdの保存内容から設定を変えている場合はtrue。 */
  modified: boolean;
  /**
   * プリセットを適用する。変更を破棄して保存内容へ戻す操作にも使う。
   * @param id - 適用するプリセットID。
   */
  onApply: (id: string) => void;
  /**
   * 現在の設定を保存する。presetId を渡した場合はその保存済みプリセットを上書きする。
   * @param name - 1〜64文字に正規化済みの名前。
   * @param presetId - 上書きする保存済みプリセットのID。新規保存では省略する。
   */
  onSave: (name: string, presetId?: string) => void;
  /**
   * 保存済みプリセットの名前を変更する。
   * @param id - 対象の保存済みプリセットID。
   * @param name - 正規化済みの新しい名前。
   */
  onRename: (id: string, name: string) => void;
  /**
   * 保存済みプリセットを削除する。確認はせず即時に削除し、取り消しは onRestore で行う。
   * @param id - 対象の保存済みプリセットID。
   */
  onDelete: (id: string) => void;
  /**
   * 削除した設定を、削除前の位置のまま戻し、選択中にする（削除の「元に戻す」）。
   * @param preset - 削除前の設定。
   * @param index - 削除前の一覧での位置。
   */
  onRestore: (preset: OutputPreset, index: number) => void;
  /**
   * 上書きした設定の中身を、上書き前の内容へ戻す（上書きの「元に戻す」）。今の出力設定の値は変えない。
   * @param preset - 上書き前の設定（ID・名前・保存内容）。
   */
  onRevertOverwrite: (preset: OutputPreset) => void;
  /** 保存済みプリセットをJSONから読み込む。ファイル選択はHostが行う。 */
  onImport: () => void;
  /** 保存済みプリセットをJSONへ書き出す。保存先の選択はHostが行う。 */
  onExport: () => void;
}

/** 名前入力欄の用途。 */
type NameEditMode = "saveAs" | "rename";

/**
 * 既存名と重ならない「名前 (n)」を作る。同じ名前で確定すると既存の設定への上書きになるため、
 * 新規保存の初期値では意図しない上書きを避ける。
 * @param base - 元にする名前。空なら空文字列を返す。
 * @param presets - 既存のプリセット一覧。
 * @returns 重複しない候補名。64文字を超えないよう元の名前を切り詰める。
 */
function uniqueCopyName(base: string, presets: readonly OutputPreset[]): string {
  if (!base) return "";
  const taken = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()));
  for (let index = 2; index < 1000; index += 1) {
    const suffix = ` (${index})`;
    const candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return "";
}

/**
 * 印刷設定パネル上部のプリセット行。選択欄、操作メニュー、変更ありの表示、名前入力、削除の取り消しを持つ。
 * 普段使わない操作はメニューにまとめ、変更があるときだけ保存・元に戻すを表に出す。
 * 削除と上書きは確認で止めない。直前の削除・上書きは、状態行に出す「元に戻す」で取り消せる。
 * @param messages - 表示文言。
 * @param presets - ユーザーが保存した設定の一覧。
 * @param presetId - 表示するプリセットID。空文字列はどのプリセットにも属さない設定。
 * @param modified - 表示中のプリセットから設定を変えているか。
 * @param onApply - プリセットの適用処理（変更の破棄にも使う）。
 * @param onSave - 新規保存・上書き保存の処理。
 * @param onRename - 名前変更の処理。
 * @param onDelete - 削除の処理。
 * @param onRestore - 削除した設定を戻す処理。
 * @param onRevertOverwrite - 上書きした設定を上書き前の内容へ戻す処理。
 * @param onImport - JSONからの読み込み処理。
 * @param onExport - JSONへの書き出し処理。
 * @returns プリセット操作の要素。
 */
export function OutputPresetManager({
  messages,
  presets,
  presetId,
  modified,
  onApply,
  onSave,
  onRename,
  onDelete,
  onRestore,
  onRevertOverwrite,
  onImport,
  onExport,
}: OutputPresetManagerProps): React.JSX.Element {
  const labels = messages.ribbon.labels;
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameEdit, setNameEdit] = useState<NameEditMode | undefined>(undefined);
  const [draftName, setDraftName] = useState("");
  /**
   * 取り消せる直前の変更（削除した設定と削除前の位置、または上書き前の設定）。「元に戻す」を出している間だけ持ち、
   * 別の操作（選択・新規保存・名前の入力・メニュー）を始めたら消す。パネルを閉じた場合も消える。
   */
  const [lastChange, setLastChange] = useState<
    | { kind: "deleted"; preset: OutputPreset; index: number }
    | { kind: "overwritten"; preset: OutputPreset }
    | undefined
  >(undefined);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // 一覧はユーザーが保存した設定だけなので、選択中の設定があれば上書き・名前変更・削除の対象になる。
  const current = presets.find((preset) => preset.id === presetId);

  useEffect(() => {
    // 別ウィンドウや Host の通知で表示中の設定が変わったら、古い対象への入力を残さない。
    setNameEdit(undefined);
  }, [presetId]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    /**
     * メニューの外を押したら閉じる。メニュー内の操作は各項目のクリック処理に任せる。
     * @param event - 文書全体のポインター押下イベント。
     */
    const closeOnOutside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target))) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (nameEdit) nameInputRef.current?.select();
  }, [nameEdit]);

  const normalizedDraft = normalizeOutputPresetName(draftName);
  // 入力した名前と同じ名前の既存の設定（大文字と小文字は区別しない）。
  const sameNamePreset = normalizedDraft === undefined ? undefined : presets.find((preset) =>
    preset.name.toLocaleLowerCase() === normalizedDraft.toLocaleLowerCase()
    && !(nameEdit === "rename" && preset.id === presetId));
  // 新規保存で同じ名前なら確認で止めずにその設定へ上書きする。名前変更では2つを1つにできないため重複として止める。
  const overwriteTarget = nameEdit === "saveAs" ? sameNamePreset : undefined;
  const duplicateName = nameEdit === "rename" && sameNamePreset !== undefined;
  const canCommitName = normalizedDraft !== undefined && !duplicateName
    && !(nameEdit === "rename" && normalizedDraft === current?.name);

  /**
   * メニューを閉じ、メニューボタンへフォーカスを戻す。
   * @param restoreFocus - Escapeなどでボタンへ戻す場合はtrue。
   */
  const closeMenu = (restoreFocus: boolean): void => {
    setMenuOpen(false);
    if (restoreFocus) menuButtonRef.current?.focus();
  };

  /**
   * 名前入力を開始する。メニューと直前の変更の「元に戻す」は閉じる。
   * @param mode - 新規保存か名前変更か。
   */
  const startNameEdit = (mode: NameEditMode): void => {
    setMenuOpen(false);
    setLastChange(undefined);
    setDraftName(mode === "rename" ? current?.name ?? "" : uniqueCopyName(current?.name ?? "", presets));
    setNameEdit(mode);
  };

  /**
   * 名前入力を閉じ、開いた操作のボタンへフォーカスを戻す（新規保存は「＋ 新規保存」、名前変更は「⋯」）。
   * 入力欄が消えてフォーカスが文書の先頭へ飛ぶのを防ぐ。
   */
  const closeNameEdit = (): void => {
    const opener = nameEdit === "rename" ? menuButtonRef.current : addButtonRef.current;
    setNameEdit(undefined);
    opener?.focus();
  };

  /** 名前入力を確定する。無効な名前や名前変更での重複では何もしない（ボタンも無効化済み）。新規保存の同名は上書きする。 */
  const commitName = (): void => {
    if (!canCommitName || !normalizedDraft) return;
    if (nameEdit === "rename" && current) onRename(current.id, normalizedDraft);
    else if (overwriteTarget) overwrite(overwriteTarget);
    else onSave(normalizedDraft);
    closeNameEdit();
  };

  /**
   * 既存の設定を今の値で確認なしに上書きし、取り消せるよう上書き前の内容を覚える。
   * 元に戻すと名前も上書き前の名前に戻り、その設定が選択中になる（保存し直しとして扱うため）。
   * 上書きの結果が Host から届く前に続けて上書きすると、元に戻す先は最初の上書きの前の内容になる。
   * @param target - 上書きする設定。
   */
  const overwrite = (target: OutputPreset): void => {
    setLastChange({ kind: "overwritten", preset: target });
    onSave(target.name, target.id);
    // 状態行のリンクから上書きするとリンク自体が消えるため、フォーカスを「⋯」へ移す。
    // 名前欄から確定した場合は、この後の closeNameEdit が「＋ 新規保存」へ戻す。
    menuButtonRef.current?.focus();
  };

  /**
   * 選択中の設定を確認なしで削除し、取り消せるよう削除前の位置を覚える。
   * フォーカスは消えた項目ではなく「⋯」へ戻す。
   */
  const deleteCurrent = (): void => {
    if (!current) return;
    setNameEdit(undefined);
    setLastChange({ kind: "deleted", preset: current, index: presets.indexOf(current) });
    onDelete(current.id);
    menuButtonRef.current?.focus();
  };

  /** 直前の削除・上書きを取り消す。押したボタンは消えるため、フォーカスは「⋯」へ戻す。 */
  const undoLastChange = (): void => {
    if (!lastChange) return;
    if (lastChange.kind === "deleted") onRestore(lastChange.preset, lastChange.index);
    else onRevertOverwrite(lastChange.preset);
    setLastChange(undefined);
    menuButtonRef.current?.focus();
  };

  /**
   * 選択欄で別の設定を選んだら、直前の変更の「元に戻す」を消してから適用する。
   * @param id - 選んだ設定のID。
   */
  const applyFromSelect = (id: string): void => {
    setLastChange(undefined);
    onApply(id);
  };

  /**
   * Tabなどでフォーカスがメニューの外へ出たら閉じる。メニュー内の移動では閉じない。
   * @param event - メニューのフォーカス離脱イベント。
   */
  const handleMenuBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (menuRef.current?.contains(next) || menuButtonRef.current?.contains(next))) return;
    setMenuOpen(false);
  };

  /**
   * メニュー内で上下キーにより項目を移動し、Escapeで閉じる。
   * @param event - メニューのキー入力イベント。
   */
  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  /**
   * メニュー項目を作る。押したらメニューを閉じてから操作を実行する。
   * @param label - 表示名。
   * @param action - 実行する操作。
   * @param disabled - 実行できない場合はtrue。
   * @param danger - 削除などの破壊的な操作ならtrue。
   * @returns メニュー項目のボタン。
   */
  const menuItem = (label: string, action: () => void, disabled = false, danger = false): React.JSX.Element => (
    <button
      type="button"
      role="menuitem"
      className={danger ? "output-preset-menu-danger" : undefined}
      disabled={disabled}
      onClick={
        /** メニューを閉じてから操作を実行する（操作が開く名前の入力欄とメニューが重ならないように）。 */
        () => {
          setMenuOpen(false);
          action();
        }
      }
    >
      {label}
    </button>
  );

  return (
    <section className="output-preset-manager" aria-label={labels.outputPreset}>
      <div className="output-preset-row">
        <OutputPresetSelect
          messages={messages}
          presets={presets}
          presetId={presetId}
          onApply={applyFromSelect}
          className="output-preset-select"
        />
        {/* 2件目以降も迷わず追加できるよう、新規保存はメニューに隠さず常に表示する。 */}
        <button
          ref={addButtonRef}
          type="button"
          className="output-preset-add-button"
          title={labels.savePresetAs}
          aria-expanded={nameEdit === "saveAs"}
          onClick={/** 今の設定を新しい名前で保存する入力欄を開く。 */ () => startNameEdit("saveAs")}
        >
          ＋ {labels.addSavedSettings}
        </button>
        <div className="output-preset-menu-anchor">
          <button
            ref={menuButtonRef}
            type="button"
            className="output-preset-menu-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={labels.outputPresetActions}
            title={labels.outputPresetActions}
            onClick={/** 操作メニューを開閉する。別の操作を始めるので、直前の変更の「元に戻す」は消す。 */ () => {
              setLastChange(undefined);
              setMenuOpen((open) => !open);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              className="output-preset-menu"
              role="menu"
              aria-label={labels.outputPresetActions}
              onKeyDown={handleMenuKeyDown}
              onBlur={handleMenuBlur}
            >
              {menuItem(labels.overwritePreset, () => current && overwrite(current), !current || !modified)}
              {menuItem(labels.renamePreset, () => startNameEdit("rename"), !current)}
              {menuItem(labels.discardPresetChanges, () => current && onApply(current.id), !modified)}
              {menuItem(labels.deletePreset, deleteCurrent, !current, true)}
              <hr role="separator" />
              {menuItem(labels.importPresets, onImport)}
              {menuItem(labels.exportPresets, onExport, presets.length === 0)}
            </div>
          )}
        </div>
      </div>
      <div className="output-preset-status">
        {/* 読み上げが確実に働くよう状態の文言の領域は常に置き、中身だけを出し入れする。ボタンは領域の外に置く。 */}
        <span role="status">
          {lastChange && !nameEdit && (
            <span className="output-preset-change">
              {(lastChange.kind === "deleted" ? labels.presetDeleted : labels.presetOverwritten)
                .replace("{name}", lastChange.preset.name)}
            </span>
          )}
          {!lastChange && modified && current && !nameEdit && (
            <span className="output-preset-modified">
              {labels.presetModified}
            </span>
          )}
        </span>
        {lastChange && !nameEdit && (
          <button
            type="button"
            className="output-preset-link"
            onClick={undoLastChange}
          >
            {labels.undoSavedSettingsChange}
          </button>
        )}
        {!lastChange && modified && current && !nameEdit && (
          <>
            <button
              type="button"
              className="output-preset-link"
              onClick={/** 選択中の保存した設定を今の値で上書きする。 */ () => overwrite(current)}
            >
              {labels.overwritePreset}
            </button>
            <button
              type="button"
              className="output-preset-link"
              onClick={/** 選択中の保存した設定を適用し直して変更を捨てる。 */ () => applyFromSelect(current.id)}
            >
              {labels.revertPreset}
            </button>
          </>
        )}
      </div>
      {nameEdit && (
        <div className="output-preset-name-edit">
          <input
            ref={nameInputRef}
            type="text"
            maxLength={64}
            aria-label={labels.presetName}
            aria-invalid={duplicateName}
            aria-describedby={duplicateName ? "output-preset-name-error" : undefined}
            value={draftName}
            onChange={
              /**
               * 入力中の名前を保持する。確定はEnterか保存ボタンで行う。
               * @param event - 名前欄の変更イベント。
               */
              (event) => setDraftName(event.currentTarget.value)
            }
            onKeyDown={
              /**
               * Enterで確定し、Escapeで入力をやめる。
               * @param event - 名前欄のキー入力イベント。
               */
              (event) => {
                // 日本語入力の変換を確定するEnterでは保存しない（未確定の文字のまま保存されるのを防ぐ）。
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeNameEdit();
                }
              }
            }
          />
          <button type="button" className="primary" disabled={!canCommitName} onClick={commitName}>
            {/* 同じ名前の設定があるときは、押すとその設定が置き換わることをボタンの名前で示す（確認は出さない）。 */}
            {overwriteTarget ? labels.overwritePreset : labels.savePreset}
          </button>
          <button type="button" onClick={closeNameEdit}>{labels.cancelPresetEdit}</button>
          {duplicateName && (
            <p className="output-preset-name-error" id="output-preset-name-error">{labels.duplicateSavedSettingsName}</p>
          )}
        </div>
      )}
    </section>
  );
}
