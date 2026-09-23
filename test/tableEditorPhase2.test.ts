/**
 * @fileoverview tableeditorphase2・テストの回帰の仕様と回帰条件を検証する。失敗時は期待値と実装差分を示す。
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
     * 「table editor phase 2 integration」の仕様と回帰条件を検証するテストケース。
     * @returns テストケースを実行し、値は返さない。
     */
    () => {
        it("reorders data rows while keeping the Markdown header row fixed",
            /**
             * 「reorders data rows while keeping the Markdown header row fixed」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
             * 「reorders column cells and alignment markers together」の仕様と回帰条件を検証するテストケース。
             * @returns テストケースを実行し、値は返さない。
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
