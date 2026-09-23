/**
 * @file tableEditorPhase2.test.ts
 * 実行境界: テスト実行環境。
 * 責務: 現行実装の仕様と回帰条件を検証する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: テスト用のモック、ブラウザー、ファイルを必要に応じて操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import { describe, expect, it } from "vitest";
import {
  moveTableGridColumn,
  moveTableGridRow,
} from "../src/shared/tableGrid";
import {
  readTableEditorDraft,
  renderTableEditorDraft,
} from "../src/webview/tableEditorModel";

describe("table editor phase 2 integration",
/**
 * テスト「table editor phase 2 integration」の前提条件を設定し、期待結果を検証するコールバックです。
 * @returns テストの前提条件と期待結果を検証し、値を返しません。
 */
() => {
  it("reorders data rows while keeping the Markdown header row fixed",
  /**
 * テスト「reorders data rows while keeping the Markdown header row fixed」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = [
      "| Name | Value |",
      "| --- | ---: |",
      "| A | 1 |",
      "| B | 2 |",
      "| C | 3 |",
    ].join("\n");
    const draft = readTableEditorDraft(source, source.indexOf("B"));
    expect(draft).toBeDefined();
    if (!draft) return;

    draft.rows = moveTableGridRow(draft.rows, 2, 1);
    draft.activeRow = 1;
    const rendered = renderTableEditorDraft(draft).text;

    expect(rendered).toBe([
      "| Name | Value |",
      "| --- | ---: |",
      "| B | 2 |",
      "| A | 1 |",
      "| C | 3 |",
    ].join("\n"));
  });

  it("reorders column cells and alignment markers together",
  /**
 * テスト「reorders column cells and alignment markers together」の前提条件を設定し、期待結果を検証するコールバックです。
   * @returns テストの前提条件と期待結果を検証し、値を返しません。
   */
  () => {
    const source = [
      "| Left | Center | Right |",
      "| :--- | :---: | ---: |",
      "| L | C | R |",
    ].join("\n");
    const draft = readTableEditorDraft(source, source.indexOf("Center"));
    expect(draft).toBeDefined();
    if (!draft) return;

    const moved = moveTableGridColumn(
      draft.rows,
      draft.alignments,
      2,
      0,
    );
    draft.rows = moved.rows;
    draft.alignments = moved.alignments as typeof draft.alignments;
    draft.activeColumn = 0;

    expect(renderTableEditorDraft(draft).text).toBe([
      "| Right | Left | Center |",
      "| ---: | :--- | :---: |",
      "| R | L | C |",
    ].join("\n"));
  });
});
