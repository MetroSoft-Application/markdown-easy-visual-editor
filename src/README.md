# `src` 内部構造ガイド

この文書は、Markdown Easy Visual Editor の実装を変更するときに、どの層・どのファイルを確認すべきかを把握するための内部向けREADMEです。
機能仕様の正本ではなく、現在のソース構成と実行時の責務を説明します。

## 全体像

この拡張機能は、VS Codeの拡張ホストとWebviewを分離し、`postMessage`で同期するカスタムエディタです。

```text
VS Code 拡張ホスト
└─ extension/extension.ts  CustomTextEditorProvider、文書編集、画像、設定、コマンド
   ├─ shared/protocol.ts   ホストとWebviewのメッセージ契約
   ├─ shared/textChanges.ts 差分の計算・適用・変換・検証
   └─ extension/pdf.ts      PDF出力とローカル画像の埋め込み

Webview
└─ webview/index.tsx       Reactの起動
   └─ webview/App.tsx       UI全体、状態管理、ホスト連携、編集同期
      ├─ Ribbon.tsx         編集コマンドのリボンUI
      ├─ SourceEditor.tsx   CodeMirrorベースのソースエディタ
      ├─ RenderedMarkdown.tsx 描画結果の表示とインタラクション
      │  ├─ markdownRenderer.ts Markdownから安全なHTMLへの変換
      │  └─ mermaidRenderer.ts   Mermaid図のSVG描画
      ├─ scrollAnchors.ts    プレビュー位置の保持
      └─ styles.css          Webview全体のスタイル

共有ドメインロジック
├─ shared/markdown.ts       Markdown編集・解析・診断・統計
└─ shared/textChanges.ts    テキスト差分と同時編集のリベース
```

## ディレクトリ構成

### `extension/`

VS Code拡張ホスト側で実行されるコードです。VS Code API、ファイルシステム、ワークスペース文書を直接扱います。

- [`extension.ts`](./extension/extension.ts)
  - `MarkdownEasyVisualEditorProvider`を登録するメインエントリポイント。
  - カスタムエディタのWebview生成、メッセージ処理、文書変更の反映を担当。
  - 画像の保存・選択、リソースを開く、設定変更の通知、Undo/Redo、PDF出力など、ホスト権限が必要な処理を集約。
  - Webviewからの編集をキューに入れ、履歴を使って差分をリベースしてからVS Code文書へ適用。

- [`pdf.ts`](./extension/pdf.ts)
  - Webviewから受け取ったHTMLを単独のPDF出力用HTMLに組み立てる。
  - ローカル画像を読み込み、データURLとして埋め込む。
  - SVGやHTMLの危険な要素を除去し、PlaywrightとEdgeまたはChromeを使ってPDFを生成する。

### `shared/`

拡張ホストとWebviewの双方から利用する、環境依存性の低いコードです。ここにはUIやVS Code APIを置きません。

- [`protocol.ts`](./shared/protocol.ts)
  - ホストとWebviewのメッセージ型を定義する通信契約。
  - ホスト→Webviewには初期化、編集ACK、外部変更、再同期要求、設定変更、画像保存結果、操作失敗、PDF結果などがある。
  - Webview→ホストには準備完了、ローカル編集、履歴操作、画像処理、PDF出力、ソース／リソースを開く、再同期要求などがある。
  - メッセージを追加・変更するときは、送信側と受信側の両方を確認する。

- [`textChanges.ts`](./shared/textChanges.ts)
  - VS Code文書とWebviewのテキストを同期するための共通差分処理。
  - 差分の計算、適用、検証、オフセット変換、既存変更へのマッピングを提供する。
  - 外部変更と未ACKのローカル変更が競合したときのリベースに使われる。

- [`markdown.ts`](./shared/markdown.ts)
  - Markdownを編集・解析する純粋なドメインロジック。
  - 選択範囲のインライン／ブロック装飾、行プレフィックス、見出し、リンク、テーブル操作を扱う。
  - アウトライン、Markdownブロック、診断、整形、単語統計、スラッグ生成、画像Markdown生成などもここに置く。
  - UIから独立しているため、編集規則を変更した場合の主要なテスト対象になる。

### `webview/`

ReactとブラウザAPIで動作するUIです。VS Code APIを直接呼ばず、`protocol.ts`に定義されたメッセージを通じて拡張ホストと連携します。

- [`index.tsx`](./webview/index.tsx)
  - Reactアプリケーションの起動点。
  - `App`を`React.StrictMode`でマウントし、Webview用CSS・フォント・KaTeX CSSを読み込む。

- [`App.tsx`](./webview/App.tsx)
  - Webviewのオーケストレーターであり、画面全体の状態を管理する中心ファイル。
  - 編集モード、Markdown本文、設定、選択範囲、アウトライン、検索、診断、インスペクター、PDFプレビュー、ダイアログ、Toastなどを管理。
  - ホストとの初期ハンドシェイクとメッセージ処理を行う。
  - ローカル編集を楽観的に適用し、未ACK操作をキューに保持して、外部変更時にリベースする。
  - ソースエディタ、プレビュー、リボン、サイドパネル、ステータスバーを組み合わせて画面を構成する。

- [`SourceEditor.tsx`](./webview/SourceEditor.tsx)
  - CodeMirrorの初期化と、ソース編集に必要な命令型APIをカプセル化する。
  - 選択範囲、検索ハイライト、IME入力、外部テキスト同期、スクロール、ビューポート復元を扱う。
  - リボンからの見出し・リスト・リンク・コードブロック・表操作を、`shared/markdown.ts`の編集関数に接続する。

- [`RenderedMarkdown.tsx`](./webview/RenderedMarkdown.tsx)
  - Markdown描画結果をDOMに表示するReactコンポーネント。
  - Mermaid、数式、画像の描画・ロード状態を追跡し、ダブルクリックなどのプレビュー操作をAppへ通知する。

- [`markdownRenderer.ts`](./webview/markdownRenderer.ts)
  - MarkdownをHTMLへ変換する描画パイプライン。
  - `marked`、GFM、シンタックスハイライト、KaTeX、目次、脚注、アラート、Mermaidなどを組み合わせる。
  - ソース位置をHTMLの属性に保持し、アウトラインやプレビュー位置同期に利用する。
  - 出力HTMLはDOMPurifyでサニタイズする。HTMLを追加・変更するときは、表示だけでなくサニタイズ後の挙動も確認する。

- [`mermaidRenderer.ts`](./webview/mermaidRenderer.ts)
  - Mermaidのグローバル設定と描画処理を直列化する薄いアダプター。
  - Mermaidのテーマ切り替えとエラー表示用メッセージを扱う。

- [`Ribbon.tsx`](./webview/Ribbon.tsx)
  - タブ、グループ、ツールからなる編集リボンを描画する。
  - 実際の文書変更は行わず、`RibbonCommand`をAppへ通知するUI層。

- [`scrollAnchors.ts`](./webview/scrollAnchors.ts)
  - プレビュー更新やレイアウト変更の前後で、表示位置をできるだけ維持する。
  - ソースオフセット、DOM要素、画面上の相対位置を使ってアンカーを保存・復元する。

- [`id.ts`](./webview/id.ts)
  - Webviewインスタンス識別用のクライアントIDを生成する。
  - `crypto.randomUUID`、乱数API、最終フォールバックの順に利用する。

- [`global.d.ts`](./webview/global.d.ts)
  - CSSモジュールとGFM用Turndownプラグインの型宣言。

- [`styles.css`](./webview/styles.css)
  - リボン、分割レイアウト、エディタ、プレビュー、診断、ダイアログ、PDF、印刷、レスポンシブ表示をまとめたスタイル。

## 実行時のデータフロー

### 起動と初期化

1. VS Codeが [`extension.ts`](./extension/extension.ts) の `MarkdownEasyVisualEditorProvider` をカスタムエディタとして呼び出す。
2. 拡張ホストがWebview HTML、CSP、ローカルリソースの許可範囲を設定する。
3. Webviewの [`index.tsx`](./webview/index.tsx) が `App` をマウントする。
4. `App` が `{ type: "ready" }` をホストへ送り、ホストが初期本文・バージョン・設定を `init` メッセージで返す。
5. `App` が本文をソースエディタとMarkdownプレビューへ渡す。

### 通常の編集

```text
CodeMirror
  ↓ 変更
SourceEditor
  ↓ TextChange
App（ローカル状態へ楽観的に適用、未ACKキューへ追加）
  ↓ localChanges
extension.ts
  ↓ 検証、履歴へのマッピング、WorkspaceEdit
VS Code TextDocument
  ↓ onDidChangeTextDocument
extension.ts
  ↓ editAck または externalChanges
App（ACK済み操作を確定、または保留中の操作をリベース）
```

### 外部変更・競合時

- VS Codeや別の編集元が文書を変更すると、拡張ホストが変更履歴を記録する。
- Webviewから届いた変更の基準バージョンが現在の文書と異なる場合、`shared/textChanges.ts`で履歴上の変更をマッピングする。
- 変更を安全に適用できない、履歴が不足している、または検証に失敗した場合は再同期を要求する。
- Webviewはホストのスナップショットを受け取り、ローカルの未ACK操作を再適用して表示を復元する。

### コマンド・画像・PDF

- リボンやキーボード操作は、まず `App` または `SourceEditor` のコマンド処理に入る。
- 文書を変更する操作は、通常のローカル編集と同じ差分同期経路を通る。
- 画像の保存・ファイル選択・リソースのオープンは、Webviewからホストへメッセージを送り、拡張ホスト側で実行する。
- PDF出力はWebviewがHTMLとオプションをホストへ渡し、[`pdf.ts`](./extension/pdf.ts) が画像解決・サニタイズ・ブラウザ印刷を行う。

## レイヤー間の責務境界

| レイヤー | 主な責務 | 依存してよいもの |
| --- | --- | --- |
| 拡張ホスト | VS Code API、文書、ファイル、Webview通信、PDF | `shared/*`、VS Code、Node系API |
| Webview UI | React表示、ユーザー操作、表示状態、CodeMirror | `shared/*`、ブラウザAPI、UIライブラリ |
| 共有ロジック | 編集規則、差分処理、Markdown解析、通信型 | できるだけ標準TypeScriptのみ |

次の依存方向を維持してください。

```text
extension ─┐
webview   ─┼─> shared
           └─> 外部ランタイム（各実行環境で許可されたAPI）
```

WebviewからVS Code APIやファイルシステムを直接扱わないこと、共有層からReact・CodeMirror・VS Code APIを参照しないことが重要です。

## 変更時の確認ポイント

### 通信契約を変更する場合

1. [`shared/protocol.ts`](./shared/protocol.ts) の型を変更する。
2. 送信側と受信側の分岐を両方更新する。
   - ホスト側: [`extension/extension.ts`](./extension/extension.ts)
   - Webview側: [`webview/App.tsx`](./webview/App.tsx)
3. 初期化、再接続、再同期、操作失敗時の挙動を確認する。
4. 旧状態や未対応メッセージが来た場合に、無限待機や未処理のPromiseを残さない。

### Markdown編集規則を変更する場合

- まず [`shared/markdown.ts`](./shared/markdown.ts) の純粋関数を確認・変更する。
- `SourceEditor.tsx` は選択範囲やCodeMirrorとの接続に集中させる。
- 行末コード、選択範囲、複数行、空行、既存のMarkdown記法を含むケースを確認する。
- 表やリストのように前後の文脈を必要とする処理は、表示上の見た目だけでなく生成されたテキストも確認する。

### 描画を変更する場合

- [`markdownRenderer.ts`](./webview/markdownRenderer.ts) の変換結果とソース位置属性を確認する。
- [`RenderedMarkdown.tsx`](./webview/RenderedMarkdown.tsx) の画像・Mermaid・数式のライフサイクルを確認する。
- DOMPurify後のHTML、リンクや画像のURI、外部コンテンツの扱いを確認する。
- 描画更新の前後で、ソースとプレビューのスクロール位置が維持されるか確認する。

### ホスト処理を変更する場合

- 文書変更は必ずキュー、履歴、操作ID、ACK／再同期の流れを壊さないようにする。
- Webviewパネル破棄時に、リスナー・キュー・保留操作が残らないか確認する。
- パスを扱う処理では、ワークスペース境界、URI変換、ファイル種別、存在しないファイルを確認する。
- PDFやHTMLを扱う処理では、サニタイズと一時リソースの後始末を確認する。

## 検証コマンド

リポジトリのルート（`E:\source\markdown-easy-visual-editor`）で実行します。

```powershell
npm run check   # TypeScriptの型チェック
npm test        # Vitestのテスト
npm run build   # 拡張機能のビルド
```

編集同期、Markdown編集、描画位置に関係する変更では、最低限 `npm run check` と `npm test` を実行し、UIやホストの接続を変更した場合は `npm run build` まで確認してください。

## まず読むファイル

目的別の入口は次のとおりです。

| 知りたいこと | 入口 |
| --- | --- |
| 拡張機能がどう起動するか | [`extension/extension.ts`](./extension/extension.ts) |
| Webviewの画面全体と状態 | [`webview/App.tsx`](./webview/App.tsx) |
| ホストとWebviewの通信 | [`shared/protocol.ts`](./shared/protocol.ts)、`extension.ts`、`App.tsx` |
| 同時編集・差分同期 | [`shared/textChanges.ts`](./shared/textChanges.ts)、`App.tsx`、`extension.ts` |
| Markdownの編集操作 | [`shared/markdown.ts`](./shared/markdown.ts)、[`webview/SourceEditor.tsx`](./webview/SourceEditor.tsx) |
| Markdownの表示 | [`webview/markdownRenderer.ts`](./webview/markdownRenderer.ts)、[`webview/RenderedMarkdown.tsx`](./webview/RenderedMarkdown.tsx) |
| PDF出力 | [`extension/pdf.ts`](./extension/pdf.ts)、`App.tsx` |
