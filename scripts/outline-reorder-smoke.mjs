/**
 * @fileoverview ブラウザー上で目次項目のドラッグ並べ替えと本文見出しへの反映を確認する。
 */
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - 再帰検索を開始するディレクトリ。
 * @param name - 探すファイル名。
 * @returns 見つかったファイルの絶対パス。該当しない場合はundefined。
 */
async function findFile(root, name) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, name);
      if (nested) return nested;
    }
  }
}

/**
 * fixture先頭にあるスモーク専用HTMLコメントを本文から取り除く。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns スモーク指示コメントを除いたMarkdown本文。
 */
function stripInstructions(markdown) {
  return markdown.replace(/^<!--[\s\S]*?-->\s*/, '');
}

/**
 * 見出し行から次の同階層以上の見出しまでを1ブロックとして別見出し位置へ移す。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param sourceHeading - 移動するアウトライン見出しの表示文字列。
 * @param targetHeading - 移動先となる見出しの表示文字列。
 * @param position - 移動先見出しの前後を指定する値（before/after）。
 * @returns 指定した見出しブロックを移動したMarkdown本文。
 */
function moveHeadingBlock(markdown, sourceHeading, targetHeading, position) {
  const lines = markdown.split('\n');
  const sourceStart = lines.indexOf(sourceHeading);
  if (sourceStart < 0) throw new Error(`Missing source heading: ${sourceHeading}`);
  const sourceLevel = sourceHeading.match(/^#+/)?.[0].length ?? 0;

  
  const sectionEnd = /**
    * 見出しの次行から同階層以上の見出しを探し、セクションの終端を決める。
    * @param sourceLines - セクション終端を探すMarkdown本文行。
    * @param start - セクション開始見出しの行位置。
    * @param level - セクション開始見出しの階層。
    * @returns 次の同階層以上の見出し位置。該当しない場合は本文末。
   */ (sourceLines, start, level) => {
    for (let index = start + 1; index < sourceLines.length; index += 1) {
      const heading = /^(#+)\s+/.exec(sourceLines[index]);
      if (heading && heading[1].length <= level) return index;
    }
    return lines.length;
  };
  const sourceEnd = sectionEnd(lines, sourceStart, sourceLevel);
  const block = lines.slice(sourceStart, sourceEnd);
  const withoutSource = lines.slice(0, sourceStart).concat(lines.slice(sourceEnd));
  const targetStart = withoutSource.indexOf(targetHeading);
  if (targetStart < 0) throw new Error(`Missing target heading: ${targetHeading}`);
  const targetLevel = targetHeading.match(/^#+/)?.[0].length ?? 0;
  const insertion = position === 'before' ? targetStart : sectionEnd(withoutSource, targetStart, targetLevel);
  return withoutSource.slice(0, insertion).concat(block, withoutSource.slice(insertion)).join('\n');
}

/**
 * 目次・reorder・スモーク検証で読み書きするリソースの場所。
 */
const executablePath = await findFile(path.resolve('.chromium'), 'chrome-headless-shell.exe');
if (!executablePath) throw new Error('Chromium is not installed.');
/**
 * Playwright fixtureへ埋め込む、ビルド済みWebview bundle本文。
 */
const webviewBundle = await readFile(path.resolve('dist/webview.js'), 'utf8');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const markdownWorkerBundle = await readFile(path.resolve('dist/markdown-worker.js'), 'utf8');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const markdownRichWorkerBundle = await readFile(path.resolve('dist/markdown-rich-worker.js'), 'utf8');
/**
 * 目次・reorder・スモーク検証のfixtureとして読み込んだ本文または設定。
 */
const fixture = (await readFile(path.resolve('test/fixtures/outline-reorder-undo.md'), 'utf8')).replace(/\r\n?/g, '\n');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const initialText = stripInstructions(fixture);
/**
 * fixture本文をLFで分割したMarkdown行の配列です。
 */
const initialLines = initialText.split('\n');
/**
 * 目次・reorder・スモーク検証で扱う一覧または対応表。
 */
const topLevelHeadings = initialLines.filter(
/**
 * 条件を満たすlineだけを残す。
 * @param line - 正規表現で見出しレベルを判定するMarkdown本文行。

 */
(line) => /^#\s+/.test(line));
/**
 * 目次・reorder・スモーク検証で扱う一覧または対応表。
 */
const childHeadings = initialLines.filter(
/**
 * 条件を満たすlineだけを残す。
 * @param line - 正規表現で見出しレベルを判定するMarkdown本文行。

 */
(line) => /^##\s+/.test(line));
/**
 * fixtureにある第4階層見出し。祖先ブロックと一緒に移動することを確認する。
 */
const grandchildHeading = initialLines.find(
/**
 * 条件に一致する最初のlineを取得する。
 * @param line - 正規表現で見出しレベルを判定するMarkdown本文行。
 * @returns 条件に一致した最初の要素。未検出時はundefined。
 */
(line) => /^####\s+/.test(line));
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const parentMovedText = moveHeadingBlock(initialText, topLevelHeadings[0], topLevelHeadings[1], 'after');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const childMovedText = moveHeadingBlock(parentMovedText, childHeadings[0], childHeadings[1], 'after');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const crossParentMovedText = moveHeadingBlock(childMovedText, childHeadings[0], childHeadings[2], 'after');
/**
 * 目次・reorder・スモーク検証で解析・表示・保存する本文。
 */
const emptyParentMovedText = [
  '# Parent B',
  '',
  'Parent B body.',
  '## Child B-1',
  '',
  'Child B-1 body.',
  '# Parent A',
  '',
  'Parent A body.',
  '## Child A-2',
  '',
  'Child A-2 body.',
  '# Parent C',
  '',
  'Parent C body.',
  '## Child C-1',
  '',
  'Child C-1 body.',
  '# Parent D',
  '',
  'Parent D body.',
  '## Child A-1',
  '',
  'Child A-1 body.',
  '#### Grandchild A-1-a',
  '',
  'Grandchild A-1-a body.',
  ''
].join('\n');
/**
 * 初期状態で表示される見出しの順序を表します。
 */
const initialOutline = [topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[1], childHeadings[2], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 親見出しを移動した後に期待する見出し順です。
 */
const parentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 子見出しを移動した後に期待する見出し順です。
 */
const childMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], childHeadings[0], grandchildHeading, topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 別の親へ見出しを移動した後に期待する順序です。
 */
const crossParentMovedOutline = [topLevelHeadings[1], childHeadings[2], childHeadings[0], grandchildHeading, topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 子を持たない親見出しを移動した後に期待する順序です。
 */
const emptyParentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3], childHeadings[0], grandchildHeading];

/**
 * テスト用Webviewへホスト起点のMarkdown変更を通知する。
 * @param page 変更を受け取るPlaywrightのページ。
 * @param nextText ホスト側に設定する変更後のMarkdown本文。
 * @param changes Webviewへ通知する変更範囲。
 * @returns 外部変更メッセージを配送する副作用。
 */
async function sendExternalEdit(page, nextText, changes) {
  await page.evaluate(
  /**
   * テスト用ホスト本文とバージョンを更新し、外部変更を配送する。
   * @param update 外部変更後の本文と変更範囲。
   * @returns ホスト状態の更新とメッセージ配送を完了する副作用。
   */
  (update) => {
    const baseVersion = window.__mveHostVersion;
    window.__mveHostText = update.nextText;
    window.__mveHostVersion = baseVersion + 1;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'externalChanges',
        baseVersion,
        version: window.__mveHostVersion,
        changes: update.changes
      }
    }));
  },
  { nextText, changes });
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(

  () => {
    window.__mveMessages = [];
    window.__mveHostVersion = 1;
    window.__mveHostText = '';
    window.__mveUndoStack = [];
    window.__mveRedoStack = [];
    window.acquireVsCodeApi =
    /**
     * WebviewからVS Codeのメッセージ送信・状態保存APIを取得する。
     * @returns VS Codeのメッセージ送信・状態保存API。
     */
    () => ({

      
      postMessage: /**
       * Webviewの送信を記録し、編集要求はテストHost本文へ適用してacknowledgementを返す。
       * @param message - WebviewからテストHostへ送られた要求。
       */ (message) => {
        window.__mveMessages.push(message);
        if (message.type === 'localChanges') {
          window.__mveUndoStack.push(window.__mveHostText);
          window.__mveRedoStack = [];
          const baseVersion = window.__mveHostVersion;
          for (const change of [...message.changes].sort(
          /**
           * 2つの値を比較して並び順を決める。
           * @param left - 比較対象の左側の値。
           * @param right - 比較対象の右側の値。
           * @returns 2つの要素の順序を示す数値。
           */
          (left, right) => right.rangeOffset - left.rangeOffset)) {
            window.__mveHostText = window.__mveHostText.slice(0, change.rangeOffset)
              + change.text
              + window.__mveHostText.slice(change.rangeOffset + change.rangeLength);
          }
          window.__mveHostVersion += 1;
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'editAck',
              clientId: message.clientId,
              opId: message.opId,
              baseVersion,
              version: window.__mveHostVersion,
              changes: message.changes
            }
          })), 0);
        }
        if (message.type === 'historyCommand') {
          const sourceStack = message.command === 'undo' ? window.__mveUndoStack : window.__mveRedoStack;
          const targetStack = message.command === 'undo' ? window.__mveRedoStack : window.__mveUndoStack;
          const nextText = sourceStack.pop();
          if (nextText === undefined) return;
          const previousText = window.__mveHostText;
          targetStack.push(previousText);
          const baseVersion = window.__mveHostVersion;
          window.__mveHostText = nextText;
          window.__mveHostVersion += 1;
          setTimeout(
          /**
           * 指定時間の経過後に後続処理を実行する。
           */
          () => window.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'externalChanges',
              baseVersion,
              version: window.__mveHostVersion,
              changes: [{ rangeOffset: 0, rangeLength: previousText.length, text: nextText }]
            }
          })), 0);
        }
      },

      
      getState: /**
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * 目次・reorder・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       */ () => undefined
    });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on('pageerror',
  /**
   * pageerrorイベントで一覧追加を実行する。
   * @param error - ユーザー操作またはDOMから通知されたイベント。
   */
  (error) => errors.push(error.message));
  page.on('console',
  /**
   * consoleイベントでifを実行する。
   * @param message - ユーザー操作またはDOMから通知されたイベント。
   */
  (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.evaluate(
  /**
   * Worker scriptをWebviewから読める一時Blob URLにし、テスト用のbody属性へ渡す。
  * @returns ブラウザー内で読み取った値または変換結果。
   */
  ({ workerSource, richWorkerSource }) => {
    document.body.dataset.mveMarkdownWorkerUri = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    document.body.dataset.mveMarkdownRichWorkerUri = URL.createObjectURL(new Blob([richWorkerSource], { type: 'text/javascript' }));
  }, { workerSource: markdownWorkerBundle, richWorkerSource: markdownRichWorkerBundle });
  await page.addStyleTag({ path: path.resolve('dist/styles.css') });
  await page.addStyleTag({ path: path.resolve('dist/webview.css') });
  await page.addScriptTag({ path: path.resolve('dist/webview.js') });
  await page.waitForFunction(
  /**
   * HostとWebviewのメッセージ状態が完了条件を満たすまで待機する。
   */
  () => window.__mveMessages.some(
  /**

   * @param message - HostとWebviewの間で受け渡すメッセージ。
   */
  (message) => message.type === 'ready'));
  await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @param text - Host本文として設定するMarkdown文字列。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => { window.__mveHostText = text; }, initialText);
  await page.evaluate(
  /**
    * Hostの初期化メッセージをWebviewへ送り、fixture本文と文書URIを設定する。
   * @param text - Webview初期化へ渡すMarkdown本文。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'init',
      text,
      version: 1,
      uri: 'file:///C:/outline-reorder-undo.md',
      settings: {
        language: 'ja',
        imageDirectory: 'assets/${documentBasename}',
        maxPasteSizeMb: 20,
        remoteImagesEnabled: false,
        mermaidTheme: 'default',
        workspaceTrusted: true
      }
    }
  })), initialText);
  await page.locator('.outline-item').first().waitFor();

  await page.evaluate(
  /**
   * 右クリック後の既定メニュー抑止状態をブラウザー内で記録する。
   * @returns コンテキストメニューを記録する副作用。
   */
  () => {
    window.__mveContextMenus = [];
    window.addEventListener('contextmenu',
    /**
     * コンテキストメニューイベントの最終的な既定処理状態を保存する。
     * @param event ブラウザーが発生させたコンテキストメニューイベント。
     * @returns メニュー抑止状態を記録するタイマー。
     */
    (event) => {
      setTimeout(
      /**
       * Reactのイベント処理後に既定メニュー抑止状態を記録する。
       * @returns メニュー抑止状態を記録する副作用。
       */
      () => window.__mveContextMenus.push(event.defaultPrevented), 0);
    }, true);
  });

  const sectionMenu = page.locator('.section-link-context-menu');
  const initialTreeShape = await page.evaluate(
  /**
   * 最初のアウトライン階層と開閉ボタン、葉の枝線の配置を確認する。
   * @returns 表示項目数、深さ、字下げ、三角形のアクセシビリティ属性。
   */
  () => {
    const tree = document.querySelector('.outline-tree');
    const roots = tree ? Array.from(tree.children) : [];
    const firstRoot = roots[0];
    const firstRootChildren = firstRoot?.querySelector(':scope > .outline-children');
    const firstChild = firstRootChildren?.firstElementChild;
    const firstChildChildren = firstChild?.querySelector(':scope > .outline-children');
    const deepestChild = firstChildChildren?.firstElementChild;
    const rootLeaf = roots.at(-1);
    const rootLabel = firstRoot?.querySelector(':scope > .outline-row > .outline-item');
    const childLabel = firstChild?.querySelector(':scope > .outline-row > .outline-item');
    const leafSibling = firstRootChildren?.lastElementChild;
    const leafLabel = leafSibling?.querySelector(':scope > .outline-row > .outline-item');
    const rootLeafLabel = rootLeaf?.querySelector(':scope > .outline-row > .outline-item');
    const deepestLabel = deepestChild?.querySelector(':scope > .outline-row > .outline-item');
    const rootDisclosure = firstRoot?.querySelector(':scope > .outline-row > .outline-disclosure');
    const leafDisclosure = leafSibling?.querySelector(':scope > .outline-row > .outline-disclosure');
    const rootRow = firstRoot?.querySelector(':scope > .outline-row');
    const childRow = firstChild?.querySelector(':scope > .outline-row');
    const rootLeafRow = rootLeaf?.querySelector(':scope > .outline-row');
    const branch = firstRootChildren ? getComputedStyle(firstRootChildren, '::before') : undefined;
    const connector = firstRootChildren?.firstElementChild
      ? getComputedStyle(firstRootChildren.firstElementChild, '::before')
      : undefined;
    const leafConnector = leafSibling ? getComputedStyle(leafSibling, '::before') : undefined;
    let leafDisclosureCount = 0;
    for (const node of tree?.querySelectorAll('.outline-node') ?? []) {
      if (node.querySelector(':scope > .outline-children')) continue;
      if (node.querySelector(':scope > .outline-row > .outline-disclosure')) {
        leafDisclosureCount += 1;
      }
    }
    return {
      rootCount: roots.length,
      renderedHeadingCount: document.querySelectorAll('.outline-item').length,
      firstRootChildCount: firstRootChildren?.children.length ?? 0,
      firstChildChildCount: firstChildChildren?.children.length ?? 0,
      deepestLevel: deepestChild?.dataset.outlineLevel,
      rootIndent: rootLabel?.getBoundingClientRect().left,
      childIndent: childLabel?.getBoundingClientRect().left,
      leafSiblingIndent: leafLabel?.getBoundingClientRect().left,
      rootLeafIndent: rootLeafLabel?.getBoundingClientRect().left,
      deepestIndent: deepestLabel?.getBoundingClientRect().left,
      disclosureName: rootDisclosure?.getAttribute('aria-label'),
      disclosureExpanded: rootDisclosure?.getAttribute('aria-expanded'),
      disclosureHasTitle: rootDisclosure?.hasAttribute('title'),
      disclosureWidth: rootDisclosure?.getBoundingClientRect().width,
      disclosurePosition: rootDisclosure ? getComputedStyle(rootDisclosure).position : undefined,
      rootDisclosureRight: rootDisclosure?.getBoundingClientRect().right,
      rootLabelLeft: rootLabel?.getBoundingClientRect().left,
      childDisclosureRight: firstChild?.querySelector(':scope > .outline-row > .outline-disclosure')
        ?.getBoundingClientRect().right,
      childLabelLeft: childLabel?.getBoundingClientRect().left,
      leafConnectorWidth: leafConnector?.width,
      parentConnectorWidth: connector?.width,
      rootHoverInset: rootRow ? getComputedStyle(rootRow, '::before').left : undefined,
      childHoverInset: childRow ? getComputedStyle(childRow, '::before').left : undefined,
      rootLeafHoverInset: rootLeafRow ? getComputedStyle(rootLeafRow, '::before').left : undefined,
      rootLeafMarginLeft: rootLeafRow ? getComputedStyle(rootLeafRow).marginLeft : undefined,
      leafHasDisclosure: leafDisclosure !== null,
      leafDisclosureCount,
      spacerCount: document.querySelectorAll('.outline-disclosure-spacer').length,
      branchStyle: branch?.borderLeftStyle,
      connectorStyle: connector?.borderTopStyle
    };
  });
  if (
    initialTreeShape.rootCount !== 4 ||
    initialTreeShape.renderedHeadingCount !== 9 ||
    initialTreeShape.firstRootChildCount !== 2 ||
    initialTreeShape.firstChildChildCount !== 1 ||
    initialTreeShape.deepestLevel !== '4' ||
    initialTreeShape.branchStyle !== 'solid' ||
    initialTreeShape.connectorStyle !== 'solid' ||
    initialTreeShape.disclosureName !== topLevelHeadings[0].replace(/^#+\s+/, '') ||
    initialTreeShape.disclosureExpanded !== 'true' ||
    initialTreeShape.disclosureHasTitle ||
    initialTreeShape.leafHasDisclosure ||
    initialTreeShape.leafDisclosureCount !== 0 ||
    initialTreeShape.spacerCount !== 0 ||
    initialTreeShape.disclosureWidth !== 16 ||
    initialTreeShape.disclosurePosition !== 'absolute' ||
    initialTreeShape.rootDisclosureRight !== initialTreeShape.rootLabelLeft ||
    initialTreeShape.childDisclosureRight !== initialTreeShape.childLabelLeft ||
    initialTreeShape.parentConnectorWidth !== '14px' ||
    initialTreeShape.leafConnectorWidth !== '32px' ||
    initialTreeShape.rootHoverInset !== '-18px' ||
    initialTreeShape.childHoverInset !== '-40px' ||
    initialTreeShape.rootLeafHoverInset !== '0px' ||
    initialTreeShape.rootLeafMarginLeft !== '-18px' ||
    initialTreeShape.rootIndent - initialTreeShape.rootLeafIndent !== 18 ||
    initialTreeShape.rootIndent >= initialTreeShape.childIndent ||
    Math.abs(initialTreeShape.childIndent - initialTreeShape.leafSiblingIndent) > 1 ||
    initialTreeShape.childIndent >= initialTreeShape.deepestIndent
  ) {
    throw new Error(`Initial outline tree did not preserve the hierarchy and control layout: ${JSON.stringify(initialTreeShape)}`);
  }

  const initialDisclosure = page.locator('.outline-disclosure').first();
  const initialHeadingText = await page.evaluate(
  /**
   * 三角形を操作する前のMarkdown本文を読み取る。
   * @returns ホスト側の現在のMarkdown本文。
   */
  () => window.__mveHostText);
  const initialLocalChangeCount = await page.evaluate(
  /**
   * 三角形を操作する前のローカル本文変更数を数える。
   * @returns ローカル本文変更メッセージ数。
   */
  () => {
    let count = 0;
    for (const message of window.__mveMessages) {
      if (message.type === 'localChanges') count += 1;
    }
    return count;
  });
  await initialDisclosure.click();
  await page.waitForFunction(
  /**
   * 開閉三角形が子見出しを非表示にしたことを確認する。
   * @returns 折りたたみ属性と表示見出し数の一致状態。
   */
  () => document.querySelector('.outline-disclosure')?.getAttribute('aria-expanded') === 'false'
    && document.querySelectorAll('.outline-item').length === 9
    && document.querySelectorAll('.outline-children[hidden] .outline-item').length === 3);

  const contextCountBeforeTriangleClick = await page.evaluate(
  /**
   * 三角形の右クリック前の既定メニュー記録数を読み取る。
   * @returns ブラウザーの右クリック記録数。
   */
  () => window.__mveContextMenus.length);
  await initialDisclosure.click({ button: 'right' });
  await page.waitForFunction(
  /**
   * 三角形の右クリックで発生したコンテキストメニューイベントを待つ。
   * @param expectedCount 右クリック後に必要となる記録数。
   * @returns 右クリックイベントが記録された状態。
   */
  (expectedCount) => window.__mveContextMenus.length >= expectedCount,
  contextCountBeforeTriangleClick + 1);
  if (
    !(await page.evaluate(
    /**
     * 三角形上の右クリックがブラウザーの既定メニューを抑止したか確認する。
     * @returns 直近の既定メニュー抑止結果。
     */
    () => window.__mveContextMenus.at(-1))) ||
    await initialDisclosure.getAttribute('aria-expanded') !== 'false' ||
    await sectionMenu.count() !== 0
  ) {
    throw new Error('Right-clicking the disclosure triangle opened a menu or changed its state.');
  }
  const localChangeCountAfterTriangleClick = await page.evaluate(
  /**
   * 三角形の右クリック後に本文変更メッセージが発生していないか調べる。
   * @returns ローカル本文変更メッセージ数。
   */
  () => {
    let count = 0;
    for (const message of window.__mveMessages) {
      if (message.type === 'localChanges') count += 1;
    }
    return count;
  });
  const textAfterTriangleClick = await page.evaluate(
  /**
   * 三角形の右クリック後のMarkdown本文を読み取る。
   * @returns ホスト側の現在のMarkdown本文。
   */
  () => window.__mveHostText);
  if (
    localChangeCountAfterTriangleClick !== initialLocalChangeCount ||
    textAfterTriangleClick !== initialHeadingText
  ) {
    throw new Error('Right-clicking the disclosure triangle changed the Markdown document.');
  }

  const contextCountBeforeTriangleDrag = await page.evaluate(
  /**
   * 三角形からの右ドラッグ前にメニュー記録数と本文変更数を取得する。
   * @returns メニュー記録数、本文、ローカル変更数の組。
   */
  () => {
    let changes = 0;
    for (const message of window.__mveMessages) {
      if (message.type === 'localChanges') changes += 1;
    }
    return {
      menus: window.__mveContextMenus.length,
      text: window.__mveHostText,
      changes
    };
  });
  const disclosureBox = await initialDisclosure.boundingBox();
  const targetLabelBox = await page.locator('.outline-item').nth(4).boundingBox();
  if (!disclosureBox || !targetLabelBox) throw new Error('Could not locate the disclosure drag endpoints.');
  await page.mouse.move(disclosureBox.x + disclosureBox.width / 2, disclosureBox.y + disclosureBox.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(targetLabelBox.x + targetLabelBox.width / 2, targetLabelBox.y + targetLabelBox.height / 2, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  const resultAfterTriangleDrag = await page.evaluate(
  /**
   * 三角形からの右ドラッグ後に本文・順序・メニューの状態を取得する。
   * @returns メニュー記録数、本文、ローカル変更数、見出し順の組。
   */
  () => {
    let changes = 0;
    const headingNames = [];
    for (const message of window.__mveMessages) {
      if (message.type === 'localChanges') changes += 1;
    }
    for (const item of document.querySelectorAll('.outline-item')) {
      headingNames.push(item.textContent?.trim());
    }
    return {
      menus: window.__mveContextMenus.length,
      menuStates: window.__mveContextMenus,
      text: window.__mveHostText,
      changes,
      headingNames
    };
  });
  const originalHeadingNames = [];
  for (const heading of initialOutline) {
    originalHeadingNames.push(heading.replace(/^#+\s+/, ''));
  }
  let disclosureDragExposedNativeMenu = false;
  for (const prevented of resultAfterTriangleDrag.menuStates.slice(contextCountBeforeTriangleDrag.menus)) {
    if (!prevented) disclosureDragExposedNativeMenu = true;
  }
  if (
    resultAfterTriangleDrag.text !== contextCountBeforeTriangleDrag.text ||
    resultAfterTriangleDrag.changes !== contextCountBeforeTriangleDrag.changes ||
    resultAfterTriangleDrag.headingNames.join('\n') !== originalHeadingNames.join('\n') ||
    disclosureDragExposedNativeMenu ||
    await initialDisclosure.getAttribute('aria-expanded') !== 'false' ||
    await sectionMenu.count() !== 0
  ) {
    throw new Error('Right-dragging from the disclosure triangle changed a heading or opened a menu.');
  }

  await page.locator('.outline-header .panel-close-button').click();
  await page.locator('.outline-reopen').click();
  if (await page.locator('.outline-disclosure').first().getAttribute('aria-expanded') !== 'false') {
    throw new Error('Hiding and reopening the outline reset its collapsed state.');
  }
  await initialDisclosure.focus();
  await initialDisclosure.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const disclosureFocus = await page.evaluate(
  /**
   * キーボードフォーカス時の三角形のフォーカス表示を確認する。
   * @returns フォーカス可視状態とアウトライン線の幅。
   */
  () => {
    const active = document.activeElement;
    const style = active instanceof HTMLElement ? getComputedStyle(active) : undefined;
    return {
      focusVisible: active?.matches(':focus-visible') ?? false,
      outlineWidth: style?.outlineWidth
    };
  });
  if (!disclosureFocus.focusVisible || Number.parseFloat(disclosureFocus.outlineWidth) <= 0) {
    throw new Error(`The disclosure triangle did not show a keyboard focus ring: ${JSON.stringify(disclosureFocus)}`);
  }
  await initialDisclosure.press('Space');
  if (await initialDisclosure.getAttribute('aria-expanded') !== 'true') {
    throw new Error('Space did not expand the focused disclosure triangle.');
  }
  await initialDisclosure.press('Enter');
  if (await initialDisclosure.getAttribute('aria-expanded') !== 'false') {
    throw new Error('Enter did not collapse the focused disclosure triangle.');
  }
  await initialDisclosure.click();

  const themeAndWidth = await page.evaluate(
  /**
   * 明暗テーマと狭いパネル幅で、アウトラインの文字・枝線・行高を確認する。
   * @returns テーマごとの色、開閉ボタンの幅、文字省略の設定。
   */
  () => {
    const panel = document.querySelector('.outline-panel');
    const label = document.querySelector('.outline-item');
    const disclosure = document.querySelector('.outline-disclosure');
    if (!(panel instanceof HTMLElement) || !(label instanceof HTMLElement) || !(disclosure instanceof HTMLElement)) {
      return undefined;
    }
    const originalFlexBasis = panel.style.flexBasis;
    const originalRootTheme = document.documentElement.dataset.editorTheme;
    const originalTheme = document.body.dataset.editorTheme;
    panel.style.flexBasis = '160px';
    document.documentElement.dataset.editorTheme = 'light';
    document.body.dataset.editorTheme = 'light';
    const lightText = getComputedStyle(label).color;
    const lightBranch = getComputedStyle(document.querySelector('.outline-children'), '::before').borderLeftColor;
    document.documentElement.dataset.editorTheme = 'dark';
    document.body.dataset.editorTheme = 'dark';
    const darkText = getComputedStyle(label).color;
    const darkBranch = getComputedStyle(document.querySelector('.outline-children'), '::before').borderLeftColor;
    const result = {
      panelWidth: panel.getBoundingClientRect().width,
      disclosureWidth: disclosure.getBoundingClientRect().width,
      rowHeight: label.getBoundingClientRect().height,
      textOverflow: getComputedStyle(label).textOverflow,
      whiteSpace: getComputedStyle(label).whiteSpace,
      overflow: getComputedStyle(label).overflow,
      lightText,
      darkText,
      lightBranch,
      darkBranch
    };
    panel.style.flexBasis = originalFlexBasis;
    if (originalRootTheme === undefined) delete document.documentElement.dataset.editorTheme;
    else document.documentElement.dataset.editorTheme = originalRootTheme;
    if (originalTheme === undefined) delete document.body.dataset.editorTheme;
    else document.body.dataset.editorTheme = originalTheme;
    return result;
  });
  if (
    !themeAndWidth ||
    themeAndWidth.panelWidth > 165 ||
    themeAndWidth.disclosureWidth !== 16 ||
    themeAndWidth.rowHeight !== 22 ||
    themeAndWidth.textOverflow !== 'ellipsis' ||
    themeAndWidth.whiteSpace !== 'nowrap' ||
    themeAndWidth.overflow !== 'hidden' ||
    themeAndWidth.lightText === themeAndWidth.darkText ||
    themeAndWidth.lightBranch === themeAndWidth.darkBranch
  ) {
    throw new Error(`The outline did not adapt to themes and a narrow panel: ${JSON.stringify(themeAndWidth)}`);
  }
  if (process.env.MVE_OUTLINE_SCREENSHOT_PREFIX) {
    const screenshotPrefix = path.resolve(process.env.MVE_OUTLINE_SCREENSHOT_PREFIX);
    const screenshotOriginalStyle = await page.evaluate(
    /**
     * テーマ別画面撮影前のパネル幅とテーマ属性を保存する。
     * @returns 撮影後に復元する表示状態。
     */
    () => {
      const panel = document.querySelector('.outline-panel');
      return {
        flexBasis: panel instanceof HTMLElement ? panel.style.flexBasis : '',
        htmlTheme: document.documentElement.dataset.editorTheme,
        bodyTheme: document.body.dataset.editorTheme
      };
    });
    await page.evaluate(
    /**
     * 指定テーマと細い幅でアウトライン画面を表示する。
     * @param theme 撮影対象の明暗テーマ。
     * @returns 画面撮影用のテーマとパネル幅を設定する副作用。
     */
    (theme) => {
      const panel = document.querySelector('.outline-panel');
      if (panel instanceof HTMLElement) panel.style.flexBasis = '220px';
      document.documentElement.dataset.editorTheme = theme;
      document.body.dataset.editorTheme = theme;
    },
    'light');
    await page.mouse.move(1200, 700);
    await page.evaluate(
    /**
     * 比較画像にキーボードフォーカス枠を残さないよう、現在の要素からフォーカスを外す。
     * @returns 現在のフォーカス可能要素をぼかす副作用。
     */
    () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.locator('.outline-panel').screenshot({ path: `${screenshotPrefix}-light.png` });
    await page.evaluate(
    /**
     * 指定テーマと細い幅でアウトライン画面を表示する。
     * @param theme 撮影対象の明暗テーマ。
     * @returns 画面撮影用のテーマとパネル幅を設定する副作用。
     */
    (theme) => {
      const panel = document.querySelector('.outline-panel');
      if (panel instanceof HTMLElement) panel.style.flexBasis = '220px';
      document.documentElement.dataset.editorTheme = theme;
      document.body.dataset.editorTheme = theme;
    },
    'dark');
    await page.locator('.outline-panel').screenshot({ path: `${screenshotPrefix}-dark.png` });
    await page.evaluate(
    /**
     * 画面撮影後に変更前のパネル幅とテーマ属性を復元する。
     * @param previous 撮影前に保存した表示状態。
     * @returns 表示状態を撮影前へ戻す副作用。
     */
    (previous) => {
      const panel = document.querySelector('.outline-panel');
      if (panel instanceof HTMLElement) panel.style.flexBasis = previous.flexBasis;
      if (previous.htmlTheme === undefined) delete document.documentElement.dataset.editorTheme;
      else document.documentElement.dataset.editorTheme = previous.htmlTheme;
      if (previous.bodyTheme === undefined) delete document.body.dataset.editorTheme;
      else document.body.dataset.editorTheme = previous.bodyTheme;
    },
    screenshotOriginalStyle);
  }

  const firstOutlineItem = page.locator('.outline-item').first();
  const firstSectionId = await firstOutlineItem.getAttribute('data-section-id');
  const firstSectionText = (await firstOutlineItem.textContent()).trim();
  await firstOutlineItem.click({ button: 'right' });
  await sectionMenu.waitFor();
  await page.waitForFunction(() => window.__mveContextMenus.length > 0);
  if (!(await page.evaluate(() => window.__mveContextMenus.at(-1)))) {
    throw new Error('Outline right-click left the native context menu enabled.');
  }
  await sectionMenu.locator('button').nth(0).click();
  await page.waitForFunction(
    ({ id, text }) => window.__mveMessages.some((message) => message.type === 'copySectionLink' && message.id === id && message.text === text),
    { id: firstSectionId, text: firstSectionText }
  );
  const previewHeading = page.locator('.split-preview .rendered-markdown h1[id]').first();
  await previewHeading.click({ button: 'right' });
  await sectionMenu.waitFor();
  await page.waitForFunction(() => window.__mveContextMenus.length > 1);
  if (!(await page.evaluate(() => window.__mveContextMenus.at(-1)))) {
    throw new Error('Preview heading right-click left the native context menu enabled.');
  }
  if (await previewHeading.getAttribute('id') !== firstSectionId) {
    throw new Error('Preview and outline heading IDs differ.');
  }
  const copyCount = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'copySectionLink').length);
  await sectionMenu.locator('button').nth(0).click();
  await page.waitForFunction(
    (count) => window.__mveMessages.filter((message) => message.type === 'copySectionLink').length === count + 1,
    copyCount
  );
  const copiedPreviewId = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'copySectionLink').at(-1)?.id);
  if (copiedPreviewId !== firstSectionId) throw new Error('Preview copied a different heading ID.');
  const copiedPreviewText = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'copySectionLink').at(-1)?.text);
  if (copiedPreviewText !== firstSectionText) throw new Error('Preview copied a different heading label.');
  const workspaceCopyCount = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'copySectionLink').length);
  await firstOutlineItem.click({ button: 'right' });
  await sectionMenu.waitFor();
  await sectionMenu.locator('button').nth(1).click();
  await page.waitForFunction(
    (count) => window.__mveMessages.filter((message) => message.type === 'copySectionLink').length === count + 1,
    workspaceCopyCount
  );
  const workspaceCopy = await page.evaluate(() => window.__mveMessages.filter((message) => message.type === 'copySectionLink').at(-1));
  if (workspaceCopy.scope !== 'workspace' || workspaceCopy.id !== firstSectionId || workspaceCopy.text !== firstSectionText) {
    throw new Error('Workspace link copy sent the wrong scope or heading.');
  }
  await previewHeading.click({ button: 'right' });
  await sectionMenu.waitFor();
  await page.keyboard.press('Escape');
  if (await sectionMenu.count()) throw new Error('Escape did not close the section link menu.');
  const anchorTargets = await page.evaluate(() => {
    const root = document.querySelector('.split-preview .rendered-markdown');
    const reached = [];
    for (const [id, href] of [['123', '#123'], ['a.b', '#a.b'], ['a b', '#a%20b'], ['拡張構文', '#拡張構文'], ['a&copy;', '#a%26copy;']]) {
      const heading = document.createElement('h2');
      heading.id = id;
      heading.scrollIntoView = () => reached.push(id);
      const anchor = document.createElement('a');
      anchor.setAttribute('href', href);
      root.append(heading, anchor);
      anchor.click();
      heading.remove();
      anchor.remove();
    }
    return reached;
  });
  if (anchorTargets.join(',') !== '123,a.b,a b,拡張構文,a&copy;') {
    throw new Error(`Fragment links reached the wrong headings: ${anchorTargets.join(',')}`);
  }


  
  const outlineIndex = /**
   * 表示中アウトライン内で見出し文字列が占める行位置を取得する。
   * @param heading - 行位置を探す見出し文字列。
   * @returns 一致する項目の0始まり位置。不一致なら-1。
   */ async (heading) => page.locator('.outline-item').evaluateAll(

    /**
     * @param elements - 目次・reorder・スモーク検証で走査または更新する要素。
     * @param expected - 検索する見出し文字列。
     */
    (elements, expected) => elements.findIndex(
    /**
     * @param element - 寸法または属性を読み取るDOM要素。
     */
    (element) => element.textContent?.trim() === expected.replace(/^#+\s+/, '')),
    heading
  );

  
  const drag = /**
   * 右ボタンドラッグでアウトライン項目を移動し、native context menuが抑止されたことも確認する。
   * @param sourceHeading - ドラッグ元の見出し。
   * @param targetHeading - ドロップ位置を決める見出し。
  */ async (sourceHeading, targetHeading) => {
    const contextMenuCount = await page.evaluate(() => window.__mveContextMenus.length);
    const items = page.locator('.outline-item');
    const source = await items.nth(await outlineIndex(sourceHeading)).boundingBox();
    const target = await items.nth(await outlineIndex(targetHeading)).boundingBox();
    if (!source || !target) throw new Error(`Could not locate drag target: ${sourceHeading} -> ${targetHeading}`);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(50);
    if (await page.evaluate((count) => window.__mveContextMenus.slice(count).some((prevented) => !prevented), contextMenuCount)) {
      throw new Error('Right-drag left the native context menu enabled.');
    }
    if (await sectionMenu.count()) throw new Error('Right-drag opened the section link menu.');
  };

  
  const localChangeCount = /**
   * Webviewから収集した変更通知の件数を数える。
   * @returns Webviewが送信した変更通知の件数。
   */ () => page.evaluate(

    /**
     * HostとWebviewのメッセージ状態のfilter結果を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveMessages.filter(
    /**
     * 種別「localChanges」のメッセージだけを残す。
     * @param message - メッセージのtypeを参照する走査対象。

     */
    (message) => message.type === 'localChanges').length
  );

  
  const waitForHost = /**
   * Host本文が期待値へ同期した後、編集acknowledgement処理が落ち着くまで待つ。
   * @param expected - Extension Hostへ反映される期待Markdown本文。
   */ async (expected) => {
    try {
      await page.waitForFunction(
      /**
       * Host側の本文状態が完了条件を満たすまで待機する。
       * @param text - Hostへ反映されることを期待するMarkdown本文。
       */
      (text) => window.__mveHostText === text, expected);
      await page.waitForTimeout(250);
    } catch (error) {
      const actual = await page.evaluate(
      /**
       * HostとWebviewのメッセージ状態を読み取り、検証用の値へ変換する。
       * @returns ブラウザー内で読み取った値または変換結果。
       */
      () => ({
        text: window.__mveHostText,
        messages: window.__mveMessages
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nExpected: ${JSON.stringify(expected)}\nActual state: ${JSON.stringify(actual)}`);
    }
  };

  
  const waitForOutline = /**
   * アウトラインの表示順が期待する見出し一覧と一致するまで待つ。
   * @param expected - 表示を待つ見出し文字列一覧。
   * @returns 順序が一致したとき解決するPlaywrightの待機Promise。
   */ (expected) => page.waitForFunction(
  /**
   * ブラウザー内に「.outline-item」が現れるまで待機する。
   * @param items - Webviewに表示される目次見出し文字列の期待一覧。
   */
  (items) => (
    [...document.querySelectorAll('.outline-item')].map(
     (element) => element.textContent?.trim()).join('\n')
      === items.map(
      /**
       * 各項目からreplaceを取り出して一覧化する。
       * @param item - 項目のreplaceを参照する走査対象。
       * @returns replaceを取り出した変換結果の一覧。
       */
      (item) => item.replace(/^#+\s+/, '')).join('\n')
  ), expected);

  
  const assertNoOp = /**
   * 目次・reorder・スモーク検証の入力と不変条件を検証し、違反時に失敗を通知する。
   * @param sourceHeading - 目次・reorder・スモーク検証で扱う文字列または本文。
   * @param targetHeading - 目次・reorder・スモーク検証へ渡す入力。
   * @param expected - 移動前後のHost本文と比較するMarkdown文字列。
   * @returns 条件が成立したかを示す真偽値。
   */ async (sourceHeading, targetHeading, expected) => {
    const before = await localChangeCount();
    await drag(sourceHeading, targetHeading);
    await page.waitForTimeout(150);
    const after = await localChangeCount();
    if (after !== before) throw new Error(`Forbidden move emitted localChanges: ${sourceHeading} -> ${targetHeading}`);
    if (await page.evaluate(
    /**
     * Host側の本文状態を読み取り、検証用の値へ変換する。
     * @returns ブラウザー内で読み取った値または変換結果。
     */
    () => window.__mveHostText) !== expected) {
      throw new Error(`Forbidden move changed text: ${sourceHeading} -> ${targetHeading}`);
    }
  };

  await assertNoOp(topLevelHeadings[0], childHeadings[2], initialText);
  await assertNoOp(childHeadings[0], grandchildHeading, initialText);
  await drag(topLevelHeadings[0], topLevelHeadings[1]);
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(initialText);
  await waitForOutline(initialOutline);
  await page.keyboard.press('Control+Shift+Z');
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.locator('.ribbon-tool').nth(0).click();
  await waitForHost(initialText);
  await waitForOutline(initialOutline);
  await page.locator('.ribbon-tool').nth(1).click();
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await drag(childHeadings[0], childHeadings[1]);
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(parentMovedText);
  await waitForOutline(parentMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await drag(childHeadings[0], childHeadings[2]);
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(childMovedText);
  await waitForOutline(childMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await drag(childHeadings[0], topLevelHeadings[3]);
  await waitForHost(emptyParentMovedText);
  await waitForOutline(emptyParentMovedOutline);
  await page.keyboard.press('Control+Z');
  await waitForHost(crossParentMovedText);
  await waitForOutline(crossParentMovedOutline);
  await page.keyboard.press('Control+Y');
  await waitForHost(emptyParentMovedText);
  await waitForOutline(emptyParentMovedOutline);

  await page.evaluate(() => {
    const preview = document.querySelector('.split-preview .rendered-markdown');
    if (!preview) throw new Error('Split preview Markdown is missing.');
    const link = document.createElement('a');
    link.href = '#';
    link.dataset.mveLink = '/guides/setup.md#setup';
    link.dataset.mveWorkspaceRooted = 'true';
    link.textContent = 'Workspace link smoke';
    preview.append(link);
  });
  await page.locator('.split-preview a[data-mve-workspace-rooted="true"]').click();
  await page.waitForFunction(() => window.__mveMessages.some(
    (message) => message.type === 'openResource' && message.workspaceRooted === true
  ));
  const workspaceNavigation = await page.evaluate(() => window.__mveMessages.filter(
    (message) => message.type === 'openResource'
  ).at(-1));
  if (workspaceNavigation.href !== '/guides/setup.md#setup' || workspaceNavigation.workspaceRooted !== true) {
    throw new Error('Workspace link navigation did not preserve its root-path marker.');
  }
  await page.setViewportSize({ width: 900, height: 220 });
  await page.locator('.cm-scroller').first().evaluate(
  /**
   * 見出し移動を確かめるため本文編集面を先頭位置へ戻す。
   * @param scroller スクロール位置を戻すCodeMirrorのスクローラー。
   * @returns 本文スクロール位置を先頭へ戻す副作用。
   */
  (scroller) => { scroller.scrollTop = 0; });
  await page.getByRole('navigation').getByText('Parent D', { exact: true }).click();
  await page.waitForFunction(
  /**
   * アウトライン選択後に本文編集面が対象見出し位置へ移動したことを確認する。
   * @returns 本文編集面が先頭からスクロールした状態。
   */
  () => (document.querySelector('.split-source-pane .cm-scroller')?.scrollTop ?? 0) > 0);
  await page.setViewportSize({ width: 1280, height: 720 });

  const parentADisclosure = page
    .getByRole('navigation').getByText('Parent A', { exact: true })
    .locator('xpath=..')
    .locator('.outline-disclosure');
  await parentADisclosure.click();
  if (await parentADisclosure.getAttribute('aria-expanded') !== 'false') {
    throw new Error('The moved Parent A section could not be collapsed.');
  }
  const textBeforeBodyShift = await page.evaluate(
  /**
   * 本文のみを変更する前のホストMarkdownを読み取る。
   * @returns 現在のホストMarkdown本文。
   */
  () => window.__mveHostText);
  const bodyShift = 'Outline body offset shift.\n\n';
  const textAfterBodyShift = bodyShift + textBeforeBodyShift;
  await sendExternalEdit(page, textAfterBodyShift, [
    { rangeOffset: 0, rangeLength: 0, text: bodyShift }
  ]);
  await page.waitForTimeout(250);
  const shiftedSourceState = await page.evaluate(
  /**
   * 本文だけの外部変更がCodeMirrorとテストホストへ反映された状態を取得する。
   * @returns ホスト本文、本文編集面の先頭、最新の通知種別。
   */
  () => ({
    hostText: window.__mveHostText,
    editorText: document.querySelector('.cm-content')?.textContent,
    messageTypes: window.__mveMessages.slice(-5).map(
    /**
     * テストホスト通知からtypeを取り出す。
     * @param message ホストとWebview間のテストメッセージ。
     * @returns 通知の識別文字列。
     */
    (message) => message.type)
  }));
  if (!shiftedSourceState.editorText?.startsWith(bodyShift.trim())) {
    throw new Error(`Body-only host edit did not reach the source editor: ${JSON.stringify(shiftedSourceState)}`);
  }
  if (await parentADisclosure.getAttribute('aria-expanded') !== 'false') {
    throw new Error('A body-only edit reset the outline collapsed state.');
  }

  const oldHeadingText = '# Parent A\n';
  const newHeadingText = '# Parent A renamed\n';
  const oldHeadingOffset = textAfterBodyShift.indexOf(oldHeadingText);
  if (oldHeadingOffset < 0) throw new Error('Could not locate the heading used for the structure-reset check.');
  const textAfterHeadingEdit = textAfterBodyShift.replace(oldHeadingText, newHeadingText);
  await sendExternalEdit(page, textAfterHeadingEdit, [
    { rangeOffset: oldHeadingOffset, rangeLength: oldHeadingText.length, text: newHeadingText }
  ]);
  await page.waitForFunction(
  /**
   * 見出し名変更がアウトラインへ反映されたことを確認する。
   * @param expectedName 更新後の見出し名。
   * @returns 更新後の見出し行が描画された状態。
   */
  (expectedName) => {
    for (const item of document.querySelectorAll('.outline-item')) {
      if (item.textContent?.trim() === expectedName) return true;
    }
    return false;
  },
  newHeadingText.trim().replace(/^#+\s+/, ''));
  const allHeadingsExpanded = await page.evaluate(
  /**
   * 見出し名変更後にすべての開閉三角形が展開状態へ戻ったか確認する。
   * @returns 全見出しが展開している場合はtrue。
   */
  () => {
    for (const disclosure of document.querySelectorAll('.outline-disclosure')) {
      if (disclosure.getAttribute('aria-expanded') !== 'true') return false;
    }
    return true;
  });
  if (!allHeadingsExpanded) throw new Error('Changing the heading structure did not reset all sections to expanded.');

  const renamedParentADisclosure = page
    .getByRole('navigation').getByText('Parent A renamed', { exact: true })
    .locator('xpath=..')
    .locator('.outline-disclosure');
  await renamedParentADisclosure.click();
  if (await renamedParentADisclosure.getAttribute('aria-expanded') !== 'false') {
    throw new Error('Could not collapse a section before opening a new Webview.');
  }

  const freshPage = await context.newPage();
  freshPage.setDefaultTimeout(5_000);
  const freshPageErrors = [];
  freshPage.on('pageerror',
  /**
   * 新しいWebviewで発生したブラウザー例外を記録する。
   * @param error ブラウザー内で発生した例外。
   * @returns 例外内容を記録する副作用。
   */
  (error) => freshPageErrors.push(error.message));
  await freshPage.goto('about:blank');
  await freshPage.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await freshPage.evaluate(
  /**
   * 新しいWebviewでMarkdown Workerのテスト用URLを作成する。
   * @param workers Workerのソースコード。
   * @returns Worker URLを登録する副作用。
   */
  (workers) => {
    document.body.dataset.mveMarkdownWorkerUri = URL.createObjectURL(new Blob([workers.workerSource], { type: 'text/javascript' }));
    document.body.dataset.mveMarkdownRichWorkerUri = URL.createObjectURL(new Blob([workers.richWorkerSource], { type: 'text/javascript' }));
  }, { workerSource: markdownWorkerBundle, richWorkerSource: markdownRichWorkerBundle });
  await freshPage.addStyleTag({ path: path.resolve('dist/styles.css') });
  await freshPage.addStyleTag({ path: path.resolve('dist/webview.css') });
  await freshPage.addScriptTag({ path: path.resolve('dist/webview.js') });
  await freshPage.waitForFunction(
  /**
   * 新しいWebviewがホストへreadyを通知するまで待機する。
   * @returns ready通知を受け取った状態。
   */
  () => window.__mveMessages.some(
  /**
   * ready型の通知をメッセージ一覧から探す。
   * @param message ホストとWebview間のテストメッセージ。
   * @returns ready通知の場合はtrue。
   */
  (message) => message.type === 'ready'));
  await freshPage.evaluate(
  /**
   * 新しいWebviewのホストMarkdownを初期化し、init通知を配送する。
   * @param text 新しいWebviewへ渡すMarkdown本文。
   * @returns 初期本文とWebview状態を設定する副作用。
   */
  (text) => {
    window.__mveHostText = text;
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'init',
        text,
        version: 1,
        uri: 'file:///C:/outline-reorder-undo.md',
        settings: {
          language: 'ja',
          imageDirectory: 'assets/${documentBasename}',
          maxPasteSizeMb: 20,
          remoteImagesEnabled: false,
          mermaidTheme: 'default',
          workspaceTrusted: true
        }
      }
    }));
  },
  textAfterHeadingEdit);
  await freshPage.locator('.outline-item').first().waitFor();
  const freshPageExpanded = await freshPage.evaluate(
  /**
   * 新しいWebviewで初期アウトラインが全展開か確認する。
   * @returns 全開閉三角形が展開状態の場合はtrue。
   */
  () => {
    for (const disclosure of document.querySelectorAll('.outline-disclosure')) {
      if (disclosure.getAttribute('aria-expanded') !== 'true') return false;
    }
    return true;
  });
  if (!freshPageExpanded) throw new Error('A new Webview inherited the previous Webview collapsed state.');
  if (freshPageErrors.length) throw new Error(`New Webview browser errors: ${freshPageErrors.join('\n')}`);
  await freshPage.close();

  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'parent-with-descendants',
      'child-same-parent-with-descendants',
      'child-cross-parent',
      'child-empty-parent',
      'level-change-rejected',
      'keyboard-undo-redo',
      'ribbon-undo-redo',
      'section-link-context-menu',
      'outline-tree-skipped-level-and-branches',
      'outline-triangle-click-and-drag-isolation',
      'outline-collapse-keyboard-and-panel-restore',
      'outline-themes-and-narrow-panel',
      'heading-name-navigation',
      'outline-offset-stability-and-structure-reset',
      'new-webview-starts-expanded'
    ]
  }));
} finally {
  await browser.close();
}
