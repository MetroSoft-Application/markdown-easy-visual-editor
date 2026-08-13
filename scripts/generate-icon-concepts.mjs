import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('E:/source/markdown-easy-visual-editor');
const out = path.join(root, 'resources');

const C = {
  ink: '#273444',
  source: '#2F6FEB',
  sourceFill: '#EAF2FF',
  preview: '#7C4DFF',
  previewFill: '#F1ECFF',
  paper: '#FFFFFF',
  muted: '#8A98A8',
  handle: '#F59E0B',
  white: '#FFFFFF',
};

const esc = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

let nextId = 2;
const cells = [];
const cell = (value, style, geometry, vertex = true) => {
  const id = String(nextId++);
  cells.push(`<mxCell id="${id}" value="${esc(value ?? '')}" style="${esc(style)}" vertex="${vertex ? 1 : 0}" parent="1">${geometry ? `<mxGeometry ${geometry}/>` : ''}</mxCell>`);
  return id;
};

const rect = (x, y, w, h, style, value = '') => cell(value, style, `x="${x}" y="${y}" width="${w}" height="${h}"`);
const text = (x, y, w, h, value, style = '') => rect(x, y, w, h, `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;spacing=0;${style}`, value);
const ellipse = (x, y, w, h, style) => rect(x, y, w, h, `ellipse;${style}`);
const edge = (x1, y1, x2, y2, style = '') => {
  const id = String(nextId++);
  cells.push(`<mxCell id="${id}" value="" style="${esc(`edgeStyle=none;orthogonalLoop=1;rounded=0;${style}`)}" edge="1" parent="1"><mxGeometry relative="1"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`);
  return id;
};

const pane = (x, y, w, h, side, extra = '') => {
  const fill = side === 'source' ? C.sourceFill : C.previewFill;
  const stroke = side === 'source' ? C.source : C.preview;
  return rect(x, y, w, h, `rounded=1;arcSize=14;fillColor=${fill};strokeColor=${stroke};strokeWidth=2;${extra}`);
};
const paperPane = (x, y, w, h, side, extra = '') => {
  const stroke = side === 'source' ? C.source : C.preview;
  return rect(x, y, w, h, `rounded=1;arcSize=12;fillColor=${C.paper};strokeColor=${stroke};strokeWidth=2;${extra}`);
};
const divider = (x, y, h, style = '') => edge(x, y, x, y + h, `strokeColor=${C.ink};strokeWidth=3;${style}`);
const sourceGlyph = (x, y, scale = 1, color = C.source) => {
  text(x, y, 18 * scale, 24 * scale, '#', `fontColor=${color};fontSize=${24 * scale};fontStyle=1;fontFamily=Segoe UI;`);
  edge(x + 23 * scale, y + 8 * scale, x + 38 * scale, y + 8 * scale, `strokeColor=${color};strokeWidth=2;`);
  edge(x + 23 * scale, y + 15 * scale, x + 45 * scale, y + 15 * scale, `strokeColor=${color};strokeWidth=2;`);
};
const sourceLines = (x, y, scale = 1, color = C.source) => {
  edge(x, y, x + 16 * scale, y, `strokeColor=${color};strokeWidth=2;`);
  edge(x, y + 8 * scale, x + 32 * scale, y + 8 * scale, `strokeColor=${color};strokeWidth=2;`);
  edge(x, y + 16 * scale, x + 24 * scale, y + 16 * scale, `strokeColor=${color};strokeWidth=2;`);
};
const previewLines = (x, y, scale = 1, color = C.preview) => {
  edge(x, y, x + 34 * scale, y, `strokeColor=${color};strokeWidth=3;`);
  edge(x, y + 9 * scale, x + 27 * scale, y + 9 * scale, `strokeColor=${color};strokeWidth=2;`);
  edge(x, y + 17 * scale, x + 18 * scale, y + 17 * scale, `strokeColor=${color};strokeWidth=2;`);
};
const previewDocument = (x, y, w, h, scale = 1, color = C.preview) => {
  edge(x + 6 * scale, y + 10 * scale, x + w - 8 * scale, y + 10 * scale, `strokeColor=${color};strokeWidth=3;`);
  edge(x + 6 * scale, y + 20 * scale, x + w - 15 * scale, y + 20 * scale, `strokeColor=${color};strokeWidth=2;`);
  edge(x + 6 * scale, y + 28 * scale, x + w - 24 * scale, y + 28 * scale, `strokeColor=${color};strokeWidth=2;`);
};
const arrow = (x1, y1, x2, y2, color = C.handle) => edge(x1, y1, x2, y2, `strokeColor=${color};strokeWidth=2;endArrow=block;endFill=1;`);
const dots = (x, y, color = C.handle) => { ellipse(x, y, 4, 4, `fillColor=${color};strokeColor=${color}`); ellipse(x, y + 9, 4, 4, `fillColor=${color};strokeColor=${color}`); ellipse(x, y + 18, 4, 4, `fillColor=${color};strokeColor=${color}`); };

function commonCanvas() {
  // Invisible frame fixes the exported canvas to a square without adding visual pixels.
  rect(0, 0, 128, 128, 'fillColor=none;strokeColor=none;opacity=0;');
}

const variants = [
  {
    id: '01-dual-sheet',
    title: 'Dual Sheet',
    purpose: '左右2枚の文書を均等に見せる王道型。最も説明不要。',
    build() {
      commonCanvas();
      paperPane(12, 28, 47, 72, 'source');
      paperPane(69, 28, 47, 72, 'preview');
      sourceGlyph(18, 46, 0.78); sourceLines(19, 77, 0.82);
      previewDocument(76, 45, 34, 38, 0.78);
      divider(64, 30, 68);
    },
  },
  {
    id: '02-markdown-flag',
    title: 'Markdown Flag',
    purpose: '左の大きな#を識別子にし、右の整形面を従属させる。',
    build() {
      commonCanvas();
      pane(10, 27, 51, 75, 'source');
      pane(67, 27, 51, 75, 'preview');
      text(18, 40, 34, 30, '#', `fontColor=${C.source};fontSize=35;fontStyle=1;fontFamily=Segoe UI;`);
      sourceLines(19, 77, 0.82);
      edge(76, 48, 108, 48, `strokeColor=${C.preview};strokeWidth=4;`);
      edge(76, 61, 103, 61, `strokeColor=${C.preview};strokeWidth=2;`);
      edge(76, 71, 108, 71, `strokeColor=${C.preview};strokeWidth=2;`);
      divider(64, 30, 68);
    },
  },
  {
    id: '03-gutter-handle',
    title: 'Gutter Handle',
    purpose: 'ドラッグできる中央ガターを主役にして、この機能固有の操作性を出す。',
    build() {
      commonCanvas();
      pane(10, 29, 49, 70, 'source');
      pane(69, 29, 49, 70, 'preview');
      sourceGlyph(16, 48, 0.72); sourceLines(17, 77, 0.72);
      previewLines(77, 49, 0.78);
      rect(61, 45, 6, 32, `rounded=1;arcSize=8;fillColor=${C.handle};strokeColor=${C.handle};strokeWidth=1;`);
      dots(62, 50, C.white);
      edge(55, 85, 73, 85, `strokeColor=${C.handle};strokeWidth=2;startArrow=block;endArrow=block;endFill=1;startFill=1;`);
    },
  },
  {
    id: '04-render-flow',
    title: 'Render Flow',
    purpose: 'Markdown記法からプレビューへ変換される流れを、短い矢印で示す。',
    build() {
      commonCanvas();
      paperPane(10, 33, 43, 63, 'source');
      paperPane(75, 33, 43, 63, 'preview');
      sourceGlyph(15, 48, 0.7); sourceLines(16, 75, 0.68);
      previewDocument(81, 47, 31, 33, 0.7);
      arrow(55, 63, 73, 63, C.handle);
      edge(64, 28, 64, 98, `strokeColor=${C.ink};strokeWidth=1;dashed=1;dashPattern=2 3;opacity=45;`);
    },
  },
  {
    id: '05-open-book',
    title: 'Open Book',
    purpose: '編集と結果を本の見開きに寄せ、文書ツールらしい親和性を出す。',
    build() {
      commonCanvas();
      paperPane(11, 34, 49, 61, 'source', 'rotation=-4;');
      paperPane(68, 34, 49, 61, 'preview', 'rotation=4;');
      sourceGlyph(20, 50, 0.68); sourceLines(20, 75, 0.68);
      previewDocument(77, 50, 31, 32, 0.68);
      divider(64, 35, 61, 'strokeWidth=2;');
      ellipse(60, 60, 8, 8, `fillColor=${C.ink};strokeColor=${C.ink}`);
    },
  },
  {
    id: '06-window-split',
    title: 'Window Split',
    purpose: 'VS Codeのエディター領域に自然に見える、窓枠ベースの構成。',
    build() {
      commonCanvas();
      rect(10, 24, 108, 80, `rounded=1;arcSize=12;fillColor=${C.paper};strokeColor=${C.ink};strokeWidth=3;`);
      edge(10, 38, 118, 38, `strokeColor=${C.ink};strokeWidth=2;`);
      ellipse(17, 29, 5, 5, `fillColor=${C.source};strokeColor=${C.source}`);
      ellipse(26, 29, 5, 5, `fillColor=${C.handle};strokeColor=${C.handle}`);
      ellipse(35, 29, 5, 5, `fillColor=${C.preview};strokeColor=${C.preview}`);
      rect(13, 41, 49, 59, `fillColor=${C.sourceFill};strokeColor=none;`);
      rect(66, 41, 49, 59, `fillColor=${C.previewFill};strokeColor=none;`);
      sourceGlyph(19, 52, 0.68); sourceLines(19, 78, 0.68);
      previewDocument(75, 52, 32, 31, 0.68);
      divider(64, 42, 57, 'strokeWidth=2;');
    },
  },
  {
    id: '07-offset-cards',
    title: 'Offset Cards',
    purpose: '2ペインの重なりを最小限に使い、画面分割とプレビューの奥行きを出す。',
    build() {
      commonCanvas();
      paperPane(13, 34, 55, 64, 'source');
      paperPane(60, 28, 55, 64, 'preview');
      rect(60, 92, 55, 6, `fillColor=${C.previewFill};strokeColor=${C.preview};strokeWidth=2;`);
      sourceGlyph(21, 53, 0.7); sourceLines(21, 79, 0.7);
      previewDocument(70, 47, 34, 35, 0.7);
      edge(58, 38, 58, 94, `strokeColor=${C.ink};strokeWidth=2;`);
    },
  },
  {
    id: '08-bracket-pair',
    title: 'Bracket Pair',
    purpose: '左右の面を角括弧のようなシルエットで包み、32pxで輪郭を優先する。',
    build() {
      commonCanvas();
      edge(18, 32, 12, 32, `strokeColor=${C.source};strokeWidth=5;`);
      edge(12, 32, 12, 96, `strokeColor=${C.source};strokeWidth=5;`);
      edge(12, 96, 18, 96, `strokeColor=${C.source};strokeWidth=5;`);
      edge(110, 32, 116, 32, `strokeColor=${C.preview};strokeWidth=5;`);
      edge(116, 32, 116, 96, `strokeColor=${C.preview};strokeWidth=5;`);
      edge(116, 96, 110, 96, `strokeColor=${C.preview};strokeWidth=5;`);
      sourceGlyph(26, 49, 0.72); sourceLines(27, 77, 0.72);
      previewLines(78, 49, 0.72);
      divider(64, 35, 58);
    },
  },
  {
    id: '09-cursor-to-page',
    title: 'Cursor to Page',
    purpose: '左の編集カーソルと右のページを対比し、編集→結果を直感化する。',
    build() {
      commonCanvas();
      pane(11, 29, 50, 70, 'source');
      pane(67, 29, 50, 70, 'preview');
      edge(23, 46, 23, 82, `strokeColor=${C.handle};strokeWidth=3;`);
      edge(31, 49, 51, 49, `strokeColor=${C.source};strokeWidth=3;`);
      edge(31, 59, 49, 59, `strokeColor=${C.source};strokeWidth=2;`);
      edge(31, 69, 53, 69, `strokeColor=${C.source};strokeWidth=2;`);
      previewDocument(76, 46, 32, 37, 0.76);
      arrow(56, 85, 72, 85, C.handle);
      divider(64, 31, 66);
    },
  },
  {
    id: '10-core-split',
    title: 'Core Split',
    purpose: '外形を1つにまとめ、内部の1本の分割線だけで左右2ペインを伝える最小構成。',
    build() {
      commonCanvas();
      rect(12, 29, 104, 70, `rounded=1;arcSize=16;fillColor=${C.paper};strokeColor=${C.ink};strokeWidth=3;`);
      rect(15, 32, 48, 64, `rounded=1;arcSize=12;fillColor=${C.sourceFill};strokeColor=none;`);
      rect(65, 32, 48, 64, `rounded=1;arcSize=12;fillColor=${C.previewFill};strokeColor=none;`);
      sourceGlyph(22, 48, 0.76); sourceLines(22, 77, 0.76);
      previewDocument(75, 48, 32, 35, 0.76);
      divider(64, 34, 60, 'strokeWidth=4;');
      ellipse(60, 59, 8, 8, `fillColor=${C.ink};strokeColor=${C.ink}`);
    },
  },
];

function xmlFor(variant) {
  nextId = 2;
  cells.length = 0;
  variant.build();
  const graph = `<mxGraphModel dx="1280" dy="720" grid="1" gridSize="4" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="128" pageHeight="128" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
  return `<mxfile host="Electron" modified="2026-08-13T00:00:00.000Z" agent="Codex" version="26.0.0"><diagram id="${variant.id}" name="${variant.title}">${graph}</diagram></mxfile>`;
}

const reviewRows = variants.map((v, index) => {
  const no = String(index + 1).padStart(2, '0');
  return `| ${no} | ${v.title} | ${v.purpose} | ${['均等な2枚', '左記号を強調', '中央操作', '変換の流れ', '見開き', 'VS Code窓', '重なり', '輪郭', '編集カーソル', '最小分割'][index]} |`;
}).join('\n');

const report = `# Markdown Easy Visual Editor 左Markdown／右Preview アイコン案レビュー

作成日: 2026-08-13  
対象: 32pxで一読できるプロダクトアイコン 10案  
原本: draw.io標準図形のみ（rectangle / rounded rectangle / ellipse / line / text / note相当の基本形）

## 調査結果

- VS CodeのCodiconには \`split-vertical\`、\`preview\`、\`markdown\` が別々に存在し、分割とプレビューを「領域構造＋機能記号」で表現している。参考: [VS Code Product Icon Reference](https://code.visualstudio.com/api/references/icons-in-labels)
- Lucideの \`columns-2\` は、左右の面・中央のガター・parallel / split / preview を一つの単純なシルエットにまとめている。参考: [Lucide columns-2](https://lucide.dev/icons/columns-2)
- Fluent UI System Iconsは24px系のキーライン、規則的な線幅、regular / filledの単色展開を重視している。参考: [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)

したがって本機能の識別子は、\`左右2面\`を主語にし、左面だけにMarkdownの \`#\` / 原文の線、右面だけに見出し＋本文の階層、中央に分割ガターを置く構成が妥当。矢印は「変換」や「同期」を主張する案に限って使い、全案の共通記号にはしない。

## 32px設計基準

| 基準 | 合格ライン | 禁止する状態 |
|---|---|---|
| 情報量 | 主シルエット1つ、左右の意味記号各1系統、補助記号は1つまで | 小さな文字、複数の矢印、装飾的なツールバー |
| ネガティブスペース | 32px外形の内側に4px相当の余白。ペイン間に最低2px相当の抜け | 左右が接触して一枚のカードに見える、細線が詰まる |
| シルエット | まず「左右の縦長領域＋中央の縦軸」が読める | #や矢印がないと何の形か分からない |
| 線 | 24pxライブエリアで最低1.5px相当。主線は2px相当以上 | 1px相当の淡い線だけで意味を作る |
| 色数 | 通常版はインク＋Markdown青＋Preview紫の3色以内。単色化しても左右構造が残る | グラデーション、4色以上、左右以外の強いアクセント |
| 左右の意味 | 左だけが記法的、右だけが整形的。左右の色も固定 | 両方に#、両方に同じ線、左右の意味が反転可能 |
| draw.io再現 | 基本図形と線、テキストだけで再現。外部SVG・画像・フォントアイコンなし | 手書きSVGパス、外部アイコン貼り付け、特殊プラグイン依存 |

## 10案の構図差分

| # | 案 | 構図の変え方 | 主要な読み |
|---|---|---|---|
${reviewRows}

## レビュー工程

### アートディレクション

左右ペインが主役になっているか、左Markdown／右Previewの意味が左右で混同しないか、アイコンとして輪郭が一つにまとまっているかを確認した。案01・06・10が最も説明力が高く、案03・09は機能操作まで含めて伝わる。案05・07は奥行きが出る反面、32pxでは重なりがノイズになりやすい。

### 32px判読性

各PNGに1024px版と32px版を用意した。合格条件は、縮小後に「左右2面」「中央の分割」「左の記法的な印」「右の整形的な印」のうち最低3つが残ること。線や細部が消える案は、細部を意味の根幹にしていない。

### draw.io再現性

全案は \`resources/icon-XX-*.drawio\` のXMLで、rectangle / rounded rectangle / ellipse / line / text の組み合わせ。PNGはdraw.ioデスクトップのCLIで原本から書き出した。編集者がdraw.io上で寸法・色・線幅を変更できる。

## 推奨順位

1. **案10 Core Split** — 最小の外形で左右ペインと中央境界が最も強く、32px・単色・VS Codeのツールバーで安定。
2. **案03 Gutter Handle** — この機能の「境界を調整する」操作まで含めたい場合に最適。ただし小サイズではハンドルが点に見える。
3. **案06 Window Split** — VS Codeとの文脈が最も自然。窓枠が重くなるため、製品アイコンとしては案10より情報量が多い。

案01は安全な基準案、案04は変換処理を訴求する場合の代替。案05・07は今回の要件では優先度を下げる。

## ファイル

- \`icon-01-dual-sheet.drawio\` ～ \`icon-10-core-split.drawio\`: 編集可能な原本
- 同名の \`.png\`: 1024px書き出し
- 同名の \`-32.png\`: 32px判読性確認用
- \`icon-concepts-contact-sheet.png\`: 10案一覧
`;

await fs.mkdir(out, { recursive: true });
await Promise.all(variants.map((variant) => fs.writeFile(path.join(out, `icon-${variant.id}.drawio`), xmlFor(variant), 'utf8')));
await fs.writeFile(path.join(out, 'icon-concepts-review.md'), report, 'utf8');
await fs.writeFile(path.join(out, 'icon-concepts.json'), JSON.stringify(variants.map(({ build, ...meta }) => meta), null, 2), 'utf8');
console.log(`Generated ${variants.length} draw.io concepts in ${out}`);
