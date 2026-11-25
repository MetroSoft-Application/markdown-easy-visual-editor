/**
 * @fileoverview 挿入タブの分割ボタン（コードブロック・Mermaid・絵文字）の構成・文言・挿入内容を検証するテスト（Webview のリボンと共有ロケールが対象）。
 * 回帰リスク:
 * - 言語ごとに一覧の値や並びがずれると、言語を切り替えたときに本体に入るものが変わる。
 * - 本体の初期値が変わると、変更前に選択欄を変えずにボタンを押した場合と挿入結果が変わる（プレーンテキスト、フローチャート、U+1F4D8 の青い本の絵文字）。
 * - Mermaid のひな形がコードブロックとして閉じていないと、挿入後の文書の残りがコードブロックに取り込まれる。
 * - コード言語の一覧の値が重複すると、一覧の項目のキーが重複し、✓ の位置がずれる。
 * - 「言語」「図の種類」の選択欄や「絵文字を挿入」が残ると、選択欄とボタンが別の段に分かれる不具合（実際に起きた）が再発する。
 * ribbonImplementations.tsx は拡張機能側の型検査（JSX 設定なし）の対象外にするため、動的に読み込む。
 */
import { describe, expect, it, vi } from "vitest";

// リボン実装は Webview の API を読み込むため、Node 上で読み込めるよう送信だけのスタブにする（このテストは送信を検証しない）。
vi.mock("../src/webview/runtime/vscodeApi", () => ({
  sharedVsCodeApi: {
    postMessage: vi.fn(),
  },
}));

import { getMessages, SUPPORTED_LANGUAGES } from "../src/shared/messages";
import { RIBBON_DEFINITIONS } from "../src/webview/ribbon/ribbonDefinitions";
import { resolveRibbonLabel } from "../src/webview/ribbon/ribbonLabels";
import { RIBBON_LAYOUT } from "../src/webview/ribbon/ribbonLayout";

/**
 * 選べる図の種類の値（表示順）。Mermaid 公式サイト（https://mermaid.js.org/intro/）の「Diagram Syntax」の順で、
 * プレビューの描画部品 Pele 1.6.0 が対応しない ZenUML だけを除く 31 種類。
 */
const DIAGRAM_VALUES = ["flowchart", "swimlane", "sequence", "class", "state", "er", "journey", "gantt", "pie", "quadrant", "requirement", "usecase", "gitGraph", "c4",
  "mindmap", "timeline", "sankey", "xychart", "block", "packet", "kanban", "architecture", "radar", "eventmodeling", "treemap", "venn", "ishikawa", "wardley",
  "cynefin", "treeView", "agentflow"];

/** 各ひな形の本文の 1 行目に来る Mermaid の図の宣言（DIAGRAM_VALUES と同じ順）。Pele が図の種類を判定する書き方に合わせる。 */
const DIAGRAM_DECLARATIONS = ["graph TD", "swimlane-beta", "sequenceDiagram", "classDiagram", "stateDiagram-v2", "erDiagram", "journey", "gantt", "pie title ", "quadrantChart",
  "requirementDiagram", "usecase-beta", "gitGraph", "C4Context", "mindmap", "timeline", "sankey-beta", "xychart-beta", "block-beta", "packet-beta", "kanban",
  "architecture-beta", "radar-beta", "eventmodeling", "treemap-beta", "venn-beta", "ishikawa-beta", "wardley-beta", "cynefin-beta", "treeView-beta", "agentflow-beta"];

/**
 * プレビューの描画（src/extension/peleWorker.ts）と同じ Pele のオプション。テストでも本番と同じ制限・解釈で描画できることを確かめる。
 * 文字の種類・ID の接頭辞・現在時刻はテスト用の固定値にする。
 */
const PREVIEW_RENDER_OPTIONS = {
  fontFamily: "sans-serif",
  fontFamilyMono: "monospace",
  fontSize: 16,
  idPrefix: "mve-test",
  responsive: false,
  autoDirection: false,
  limit: 50_000,
  outputLimit: 4_000_000,
  maxEdges: 5_000,
  linkSchemes: ["http", "https", "file"],
  imageSchemes: ["http", "https", "file"],
  links: true,
  images: true,
  now: new Date("2026-01-01T00:00:00Z"),
};

/** 分割ボタンの部品に渡される値（RibbonSplitMenuButtonProps のうち、このテストで使うもの）。 */
interface SplitProps {
  label: string;
  current: string;
  chooseLabel: string;
  items: { key: string; label: string; ariaLabel?: string }[];
  checkedIndex: number;
  layout: "list" | "grid";
  disabled: boolean;
  onMain: () => void;
  onPick: (index: number) => void;
}

/** 通知されたコマンド。 */
type Command = { type: string; value?: string; language?: string };

/**
 * リボン項目を描画し、分割ボタンの部品に渡された値と、操作で通知されたコマンド・変更された状態を返す。
 * @param id - リボン項目の ID（codeBlock、mermaid、emoji）。
 * @param language - 表示言語。
 * @param state - 本体に入るもの（最後に選んだもの）と読み取り専用の状態。
 * @returns 部品の値、コマンドの一覧、状態の変更の記録。
 */
async function renderSplit(
  id: "codeBlock" | "mermaid" | "emoji",
  language: string,
  state: { codeLanguage?: string; mermaidDiagram?: string; emoji?: string; readOnly?: boolean } = {},
): Promise<{ props: SplitProps; commands: Command[]; changes: string[] }> {
  const modulePath = "../src/webview/ribbon/ribbonImplementations";
  const { RIBBON_IMPLEMENTATIONS } = await import(/* @vite-ignore */ modulePath);
  const implementation = RIBBON_IMPLEMENTATIONS[id];
  expect(implementation.kind, id).toBe("control");
  const messages = getMessages(language);
  const commands: Command[] = [];
  const changes: string[] = [];
  const context = {
    messages,
    readOnly: state.readOnly ?? false,
    codeLanguage: state.codeLanguage ?? "",
    mermaidDiagram: state.mermaidDiagram ?? "flowchart",
    emoji: state.emoji ?? "\u{1F4D8}",
    setCodeLanguage: (value: string) => changes.push(`codeLanguage=${value}`),
    setMermaidDiagram: (value: string) => changes.push(`mermaidDiagram=${value}`),
    setEmoji: (value: string) => changes.push(`emoji=${value}`),
    onCommand: (command: Command) => commands.push(command),
  };
  const element = implementation.render(context, RIBBON_DEFINITIONS.items[id], (spec: Parameters<typeof resolveRibbonLabel>[0]) => resolveRibbonLabel(spec, messages));
  return { props: element.props as SplitProps, commands, changes };
}

describe("insert tab split buttons", () => {
  it("lays out the block group as code block, Mermaid, then the four other blocks, and drops the separate selectors", () => {
    const insert = RIBBON_LAYOUT.tabs.find((tab) => tab.id === "insert");
    expect(insert?.groups.find((group) => group.id === "block")?.itemIds).toEqual(["codeBlock", "mermaid", "math", "footnote", "toc", "pageBreak"]);
    expect(insert?.groups.find((group) => group.id === "assist")?.itemIds).toEqual(["note", "warning", "emoji"]);
    // 3 列 × 2 段に固定するクラス。これがないと、言語によって 1 つだけの段や重なりができる。
    expect(RIBBON_DEFINITIONS.groups.block.className).toBe("ribbon-insert-block-group");
    const allIds = RIBBON_LAYOUT.tabs.flatMap((tab) => tab.groups.flatMap((group) => group.itemIds as readonly string[]));
    for (const removed of ["codeLanguage", "mermaidDiagram", "insertEmoji"]) expect(allIds).not.toContain(removed);
  });

  it("has the same lists in every language, with unique code languages and fenced Mermaid snippets", () => {
    const reference = getMessages("en").ribbon.codeLanguages.map((item) => item.value);
    for (const language of SUPPORTED_LANGUAGES) {
      const ribbon = getMessages(language).ribbon;
      const values = ribbon.codeLanguages.map((item) => item.value);
      expect(values, language).toEqual(reference);
      expect(new Set(values).size, language).toBe(values.length);
      expect(values[0], language).toBe("");
      // 承認された案のとおり、Mermaid はコード言語の一覧から外し、Mermaid の分割ボタンで挿入する。
      expect(values, language).not.toContain("mermaid");
      for (const key of ["codeBlockChoose", "mermaidChoose", "emojiChoose"] as const) expect(ribbon.labels[key].trim(), `${language}:${key}`).not.toBe("");
      expect(ribbon.mermaidDiagrams.map((item) => item.value), language).toEqual(DIAGRAM_VALUES);
      ribbon.mermaidDiagrams.forEach((item, index) => {
        expect(item.label.trim(), `${language}:${item.value}`).not.toBe("");
        expect(item.snippet.startsWith("\n```mermaid\n"), `${language}:${item.value}`).toBe(true);
        expect(item.snippet.endsWith("\n```\n"), `${language}:${item.value}`).toBe(true);
        expect(item.snippet.split("```").length, `${language}:${item.value}`).toBe(3);
        // 図の宣言は本文の 1 行目。ツリービューのように先頭に設定（--- で囲んだ config）がある場合は、その後の行。
        const bodyLines = item.snippet.split("\n").slice(2);
        const declaration = bodyLines[0] === "---" ? bodyLines[bodyLines.indexOf("---", 1) + 1] : bodyLines[0];
        expect(declaration.startsWith(DIAGRAM_DECLARATIONS[index]), `${language}:${item.value}`).toBe(true);
      });
    }
  });

  it("renders every Mermaid snippet in every language with Pele, the renderer used by the preview", async () => {
    const { render } = await import("pele");
    const failures: string[] = [];
    for (const language of SUPPORTED_LANGUAGES) {
      for (const item of getMessages(language).ribbon.mermaidDiagrams) {
        const body = item.snippet.replace(/^\n```mermaid\n/, "").replace(/\n```\n$/, "");
        try {
          const { svg } = render(body, PREVIEW_RENDER_OPTIONS);
          if (!svg.includes("<svg")) failures.push(`${language}:${item.value}: no svg`);
        } catch (error) {
          failures.push(`${language}:${item.value}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("draws the tree view with three distinct indent levels in every language", async () => {
    // 引用符の外に / を付ける書き方では、Pele が階層を失い、子のファイルが親のフォルダーと同じ位置に並んだ（実際に起きた不具合）。
    const { render } = await import("pele");
    for (const language of SUPPORTED_LANGUAGES) {
      const item = getMessages(language).ribbon.mermaidDiagrams.find((diagram) => diagram.value === "treeView");
      const body = item!.snippet.replace(/^\n```mermaid\n/, "").replace(/\n```\n$/, "");
      const { svg } = render(body, PREVIEW_RENDER_OPTIONS);
      const xs = new Set([...svg.matchAll(/<text[^>]*\sx="([\d.]+)"/g)].map((match) => Math.round(Number(match[1]))));
      expect(xs.size, language).toBe(3);
    }
  });

  it("keeps the flowchart snippet that the Mermaid button inserted before the change", () => {
    expect(getMessages("ja").ribbon.mermaidDiagrams[0].snippet).toBe("\n```mermaid\ngraph TD\n  A[開始] --> B[完了]\n```\n");
    expect(getMessages("en").ribbon.mermaidDiagrams[0].snippet).toBe("\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```\n");
  });

  it("inserts the same things as before when nothing has been chosen yet", async () => {
    const code = await renderSplit("codeBlock", "ja");
    expect(code.props.current).toBe("プレーンテキスト");
    code.props.onMain();
    expect(code.commands).toEqual([{ type: "codeBlock", language: "" }]);

    const mermaid = await renderSplit("mermaid", "ja");
    expect(mermaid.props.current).toBe("フローチャート");
    mermaid.props.onMain();
    expect(mermaid.commands).toEqual([{ type: "insert", value: getMessages("ja").ribbon.mermaidDiagrams[0].snippet }]);

    const emoji = await renderSplit("emoji", "ja");
    expect(emoji.props.current).toBe("\u{1F4D8}");
    expect(emoji.props.layout).toBe("grid");
    emoji.props.onMain();
    expect(emoji.commands).toEqual([{ type: "insert", value: "\u{1F4D8}" }]);
  });

  it("inserts the picked item and remembers it for the main button", async () => {
    const code = await renderSplit("codeBlock", "ja");
    const python = code.props.items.findIndex((item) => item.label === "Python");
    code.props.onPick(python);
    expect(code.changes).toEqual(["codeLanguage=python"]);
    expect(code.commands).toEqual([{ type: "codeBlock", language: "python" }]);
    const remembered = await renderSplit("codeBlock", "ja", { codeLanguage: "python" });
    expect(remembered.props.current).toBe("Python");
    expect(remembered.props.checkedIndex).toBe(python);
    remembered.props.onMain();
    expect(remembered.commands).toEqual([{ type: "codeBlock", language: "python" }]);

    for (const language of SUPPORTED_LANGUAGES) {
      const diagrams = getMessages(language).ribbon.mermaidDiagrams;
      for (const [index, diagram] of diagrams.entries()) {
        const mermaid = await renderSplit("mermaid", language);
        mermaid.props.onPick(index);
        expect(mermaid.changes, `${language}:${diagram.value}`).toEqual([`mermaidDiagram=${diagram.value}`]);
        expect(mermaid.commands, `${language}:${diagram.value}`).toEqual([{ type: "insert", value: diagram.snippet }]);
      }
    }

    const emoji = await renderSplit("emoji", "ja");
    emoji.props.onPick(11);
    expect(emoji.changes).toEqual(["emoji=\u{2705}"]);
    expect(emoji.commands).toEqual([{ type: "insert", value: "\u{2705}" }]);
  });

  it("treats an unknown Mermaid value as the flowchart so the main button always inserts something", async () => {
    const mermaid = await renderSplit("mermaid", "ja", { mermaidDiagram: "unknown" });
    expect(mermaid.props.checkedIndex).toBe(0);
    mermaid.props.onMain();
    expect(mermaid.commands).toEqual([{ type: "insert", value: getMessages("ja").ribbon.mermaidDiagrams[0].snippet }]);
  });

  it("disables both parts when the document is read-only, and names the menu for screen readers", async () => {
    for (const id of ["codeBlock", "mermaid", "emoji"] as const) {
      const split = await renderSplit(id, "ja", { readOnly: true });
      expect(split.props.disabled, id).toBe(true);
      expect(split.props.chooseLabel.trim(), id).not.toBe("");
    }
    const emoji = await renderSplit("emoji", "ja");
    // 絵文字の格子は、読み上げ名を絵文字そのものにする。
    expect(emoji.props.items.every((item) => item.ariaLabel === item.label)).toBe(true);
  });
});
