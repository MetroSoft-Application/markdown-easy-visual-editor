/**
 * @fileoverview 出力プリセットの新規保存・適用・名前変更・複製・削除・JSON共有UI。
 * 設定ファイルの永続化と各出力設定の適用はExtension Hostに委譲する。
 */
import React, { useEffect, useState } from "react";
import type { OutputPreset } from "../../shared/outputPresets";

/** 出力プリセット管理パネルの入出力。 */
export interface OutputPresetManagerProps {
  language: string;
  presets: readonly OutputPreset[];
  activePresetId: string;
  onApply: (id: string) => void;
  onSave: (name: string, presetId?: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onExport: () => void;
}

/** 現在の言語に応じた操作ラベル。未翻訳言語では英語で表示する。 */
function labels(language: string) {
  return language === "ja"
    ? {
        heading: "出力プリセット", new: "新規作成", save: "現在の設定を新規保存",
        overwrite: "現在の設定で上書き", rename: "名前変更", duplicate: "複製",
        delete: "削除", apply: "この設定を適用", import: "インポート",
        confirm: "実行", cancel: "キャンセル",
        export: "エクスポート", name: "プリセット名", builtin: "標準",
        custom: "保存済み", unsaved: "カスタム（未保存）",
        current: "適用中", confirmOverwrite: "選択したプリセットを現在の設定で上書きしますか？",
        confirmDelete: "選択したプリセットを削除しますか？",
        help: "PDF・HTML・DOCXの設定と、プレビューのフォント・テーマをまとめて保存します。",
        info: "右側の設定変更は即時反映されます。保存済みの内容は「上書き」を押すまで変更されません。",
      }
    : {
        heading: "Output presets", new: "New", save: "Save current settings as new",
        overwrite: "Overwrite with current settings", rename: "Rename", duplicate: "Duplicate",
        delete: "Delete", apply: "Apply selected", import: "Import",
        confirm: "Confirm", cancel: "Cancel",
        export: "Export", name: "Preset name", builtin: "Built-in",
        custom: "Saved", unsaved: "Custom (unsaved)",
        current: "Active", confirmOverwrite: "Overwrite this preset with the current settings?",
        confirmDelete: "Delete the selected preset?",
        help: "Save PDF, HTML, DOCX, preview font and theme settings together.",
        info: "Changes on the right apply immediately; saved presets change only when you overwrite them.",
      };
}

/**
 * 出力プリセットを一覧で管理するパネル。
 * @param language - 表示言語。
 * @param presets - 組込・保存済みプリセット一覧。
 * @param activePresetId - 適用中のプリセットID。
 * @param onApply - 選択した設定を適用する処理。
 * @param onSave - 現在の出力設定を保存する処理。
 * @param onRename - プリセットの名前変更処理。
 * @param onDuplicate - プリセットの複製処理。
 * @param onDelete - プリセットの削除処理。
 * @param onImport - プリセットJSONの読み込み処理。
 * @param onExport - プリセットJSONの書き出し処理。
 * @returns 名前付きプリセットの一覧と管理操作。
 */
export function OutputPresetManager({
  language,
  presets,
  activePresetId,
  onApply,
  onSave,
  onRename,
  onDuplicate,
  onDelete,
  onImport,
  onExport,
}: OutputPresetManagerProps): React.JSX.Element {
  const t = labels(language);
  const [selectedId, setSelectedId] = useState(activePresetId || presets[0]?.id || "");
  const [draftName, setDraftName] = useState(
    presets.find((preset) => preset.id === selectedId)?.name ?? "",
  );
  const [previousActiveId, setPreviousActiveId] = useState(activePresetId);
  const [confirmation, setConfirmation] = useState<"overwrite" | "delete" | undefined>(undefined);
  useEffect(() => {
    // 他画面でプリセットが適用または新規保存された場合は選択を追従する。
    if (activePresetId !== previousActiveId) {
      setPreviousActiveId(activePresetId);
      if (activePresetId) {
        setSelectedId(activePresetId);
        setDraftName(presets.find((item) => item.id === activePresetId)?.name ?? "");
      }
    }
  }, [activePresetId, previousActiveId, presets]);
  const selected = presets.find((preset) => preset.id === selectedId);
  const isUserPreset = selected?.id.startsWith("user-") === true;
  const validName = draftName.trim().length > 0 && draftName.trim().length <= 64;
  const select = (id: string): void => {
    setConfirmation(undefined);
    setSelectedId(id);
    setDraftName(presets.find((item) => item.id === id)?.name ?? "");
  };
  return (
    <section className="output-preset-manager" aria-label={t.heading}>
      <div className="output-preset-manager-heading">
        <h3>{t.heading}</h3>
        <button type="button" onClick={() => select("")}>＋ {t.new}</button>
      </div>
      <p className="output-preset-help">{t.help}</p>
      <div className="output-preset-list" role="group" aria-label={t.heading}>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === selectedId ? "output-preset-list-item selected" : "output-preset-list-item"}
            aria-pressed={preset.id === selectedId}
            onClick={() => select(preset.id)}
          >
            <span className="output-preset-list-name">{preset.name}</span>
            <span className="output-preset-list-meta">
              {preset.id.startsWith("builtin-") ? t.builtin : t.custom}
              {" · "}{preset.pdfOptions.format}
              {preset.pdfOptions.orientation === "landscape" ? " ↔" : " ↕"}
            </span>
            {preset.id === activePresetId && <span className="output-preset-active">{t.current}</span>}
          </button>
        ))}
      </div>
      <label className="output-preset-name">
        {t.name}
        <input
          type="text"
          maxLength={64}
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && validName && !selected) onSave(draftName.trim());
          }}
        />
      </label>
      <div className="output-preset-buttons">
        {!selected && (
          <button type="button" className="primary" disabled={!validName}
            onClick={() => onSave(draftName.trim())}>{t.save}</button>
        )}
        {selected && (
          <button type="button" className="primary" onClick={() => onApply(selected.id)}>
            {t.apply}
          </button>
        )}
        {isUserPreset && selected && (
          <>
            <button type="button" disabled={!validName}
              onClick={() => setConfirmation("overwrite")}>{t.overwrite}</button>
            <button type="button" disabled={!validName || draftName.trim() === selected.name}
              onClick={() => onRename(selected.id, draftName.trim())}>{t.rename}</button>
          </>
        )}
        {selected && (
          <button type="button" onClick={() => onDuplicate(selected.id)}>{t.duplicate}</button>
        )}
        {isUserPreset && selected && (
          <button type="button" className="output-preset-delete"
            onClick={() => setConfirmation("delete")}>{t.delete}</button>
        )}
      </div>
      {confirmation && selected && (
        <div className="output-preset-confirmation" role="alert">
          <p>{confirmation === "delete" ? t.confirmDelete : t.confirmOverwrite}</p>
          <div>
            <button type="button" onClick={() => {
              if (confirmation === "delete") {
                onDelete(selected.id);
                select("");
              } else if (validName) {
                onSave(draftName.trim(), selected.id);
              }
              setConfirmation(undefined);
            }}>{t.confirm}</button>
            <button type="button" onClick={() => setConfirmation(undefined)}>{t.cancel}</button>
          </div>
        </div>
      )}
      <p className="output-preset-help">{t.info}</p>
      <div className="output-preset-share">
        <button type="button" onClick={onImport}>{t.import}</button>
        <button type="button" onClick={onExport}>{t.export}</button>
      </div>
    </section>
  );
}
