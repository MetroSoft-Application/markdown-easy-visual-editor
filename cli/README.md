# mve-convert

Markdown／Textile／Marp 文書を HTML または PDF に変換する独立した Node.js 20 以降向け CLI です。ビルドと実行はこのフォルダーだけで行えます。Windows 上の Edge または Chrome が必要で、ブラウザーは自動取得しません。

```powershell
npm ci
npm run check
npm test
node dist/mve-convert.cjs input.md --format html --output output.html
node dist/mve-convert.cjs input.md --format pdf --output output.pdf --config export.json
```

既存の出力先を上書きする場合だけ `--force` を指定します。出力先の省略時は入力と同じディレクトリへ `.html` または `.pdf` を作成します。入力ファイル自体への上書きは拒否します。HTML のリンク先文書も変換する場合は `--linked` を指定します。`--help` で全引数を表示します。

設定ファイルの例:

```json
{
  "rendering": {
    "renderFormat": "mixed",
    "editorTheme": "dark",
    "mermaidTheme": "auto",
    "mermaidFontSize": 16,
    "remoteImagesEnabled": true,
    "language": "ja"
  },
  "pdf": {
    "format": "A4",
    "orientation": "portrait",
    "margins": { "top": 15, "right": 15, "bottom": 15, "left": 15 },
    "textReplacements": []
  },
  "html": {
    "embedImages": false,
    "convertLinkedMarkdown": false,
    "showOutlineSidebar": false
  }
}
```

引数は JSON 設定より優先されます。引数の相対パスは実行ディレクトリ、JSON 内の `browserPath` と `workspaceRoot` は設定ファイルのディレクトリを基準にします。`workspaceRoot` の省略時は入力文書の親ディレクトリです。成功は終了コード `0`、引数と設定のエラーは `2`、変換と入出力の失敗は `1` です。
