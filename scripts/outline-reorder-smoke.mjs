/**
 * @fileoverview 目次・reorder・スモーク検証を開発・検証環境で実行する。前提条件や失敗条件を終了コードとログで示す。
 */
import { chromium } from 'playwright-core';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * 指定した名前のファイルを検証用ディレクトリから再帰的に探す。
 * @param root - 目次・reorder・スモーク検証へ渡す入力。
 * @param name - 目次・reorder・スモーク検証の対象や分岐を識別する値。
 * @returns 目次・reorder・スモーク検証のfind・fileが生成する結果。
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
 * 目次・reorder・スモーク検証から不要または危険な情報を除去する。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @returns 目次・reorder・スモーク検証のstrip・instructionsが生成する結果。
 */
function stripInstructions(markdown) {
  return markdown.replace(/^<!--[\s\S]*?-->\s*/, '');
}

/**
 * 目次・reorder・スモーク検証の要素を規則に従って並べ替える。
 * @param markdown - 解析・編集・変換の対象となるMarkdown本文。
 * @param sourceHeading - 目次・reorder・スモーク検証で扱う文字列または本文。
 * @param targetHeading - 目次・reorder・スモーク検証へ渡す入力。
 * @param position - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 * @returns 目次・reorder・スモーク検証のmove・heading・blockが生成する結果。
 */
function moveHeadingBlock(markdown, sourceHeading, targetHeading, position) {
  const lines = markdown.split('\n');
  const sourceStart = lines.indexOf(sourceHeading);
  if (sourceStart < 0) throw new Error(`Missing source heading: ${sourceHeading}`);
  const sourceLevel = sourceHeading.match(/^#+/)?.[0].length ?? 0;

  
  const sectionEnd = /**
   * 目次・reorder・スモーク検証のsection・endを処理し、呼び出し側へ結果または副作用を返す。
   * @param sourceLines - 目次・reorder・スモーク検証で扱う文字列または本文。
   * @param start - 目次・reorder・スモーク検証へ渡す入力。
   * @param level - 目次・reorder・スモーク検証へ渡す入力。
   * @returns 目次・reorder・スモーク検証のsection・endが生成する結果。
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
 * 目次・reorder・スモーク検証のwebview・bundleとして読み込んだ本文または設定。
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
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const initialLines = initialText.split('\n');
/**
 * 目次・reorder・スモーク検証で扱う一覧または対応表。
 */
const topLevelHeadings = initialLines.filter(
/**
 * 条件を満たすlineだけを残す。
 * @param line - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 * @returns 条件を満たした要素だけを含む一覧。
 */
(line) => /^#\s+/.test(line));
/**
 * 目次・reorder・スモーク検証で扱う一覧または対応表。
 */
const childHeadings = initialLines.filter(
/**
 * 条件を満たすlineだけを残す。
 * @param line - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 * @returns 条件を満たした要素だけを含む一覧。
 */
(line) => /^##\s+/.test(line));
/**
 * 目次・reorder・スモーク検証のgrandchild・headingに関する状態または設定。
 */
const grandchildHeading = initialLines.find(
/**
 * 条件に一致する最初のlineを取得する。
 * @param line - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 * @returns 条件に一致した最初の要素。未検出時はundefined。
 */
(line) => /^###\s+/.test(line));
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
  '### Grandchild A-1-a',
  '',
  'Grandchild A-1-a body.',
  ''
].join('\n');
/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const initialOutline = [topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[1], childHeadings[2], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const parentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[0], grandchildHeading, childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const childMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], childHeadings[0], grandchildHeading, topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const crossParentMovedOutline = [topLevelHeadings[1], childHeadings[2], childHeadings[0], grandchildHeading, topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3]];
/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const emptyParentMovedOutline = [topLevelHeadings[1], childHeadings[2], topLevelHeadings[0], childHeadings[1], topLevelHeadings[2], childHeadings[3], topLevelHeadings[3], childHeadings[0], grandchildHeading];

/**
 * 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
 */
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(
  /**
   * 要素を一覧追加へ渡し、目次・reorder・スモーク検証の結果または副作用を処理する。
   * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
   */
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
       * 目次・reorder・スモーク検証の変更または要求をHost・Webview間へ通知する。
       * @param message - HostとWebviewの間で受け渡すメッセージ。
       * @returns 目次・reorder・スモーク検証のpost・messageが生成する結果。
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
           * @returns 副作用を完了し、値は返さない。
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
           * @returns 副作用を完了し、値は返さない。
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
       * 目次・reorder・スモーク検証から必要な値またはリソースを取得する。
       * @returns 条件に一致する値。未検出時はundefinedまたはnull。
       */ () => undefined,

      
      setState: /**
       * 目次・reorder・スモーク検証の状態または本文へ変更を適用し、必要なら以前の状態へ戻す。
       * @returns 副作用を完了し、値は返さない。
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
   * @returns 副作用を完了し、値は返さない。
   */
  (error) => errors.push(error.message));
  page.on('console',
  /**
   * consoleイベントでifを実行する。
   * @param message - ユーザー操作またはDOMから通知されたイベント。
   * @returns 副作用を完了し、値は返さない。
   */
  (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>');
  await page.evaluate(
  /**
   * ブラウザーのDOM状態のcreate・object・url結果を読み取り、検証用の値へ変換する。
   * @param options - ブラウザー内で評価するコールバック。
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
   * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
   */
  () => window.__mveMessages.some(
  /**
   * 目次・reorder・スモーク検証のコールバックとしてメッセージを処理する。
   * @param message - HostとWebviewの間で受け渡すメッセージ。
   * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
   */
  (message) => message.type === 'ready'));
  await page.evaluate(
  /**
   * Host側の本文状態を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
   * @returns ブラウザー内で読み取った値または変換結果。
   */
  (text) => { window.__mveHostText = text; }, initialText);
  await page.evaluate(
  /**
   * Webviewの実行状態のdispatch・event結果を読み取り、検証用の値へ変換する。
   * @param text - ブラウザー内で評価するコールバック。
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


  
  const outlineIndex = /**
   * 目次・reorder・スモーク検証のoutline・indexを処理し、呼び出し側へ結果または副作用を返す。
   * @param heading - 目次・reorder・スモーク検証へ渡す入力。
   * @returns 目次・reorder・スモーク検証のoutline・indexが生成する結果。
   */ async (heading) => page.locator('.outline-item').evaluateAll(

    /**
     * elementsをfind・indexへ渡し、目次・reorder・スモーク検証の結果または副作用を処理する。
     * @param elements - 目次・reorder・スモーク検証で走査または更新する要素。
     * @param expected - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
     * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
     */
    (elements, expected) => elements.findIndex(
    /**
     * 要素をtrimへ渡し、目次・reorder・スモーク検証の結果または副作用を処理する。
     * @param element - 寸法または属性を読み取るDOM要素。
     * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
     */
    (element) => element.textContent?.trim() === expected.replace(/^#+\s+/, '')),
    heading
  );

  
  const drag = /**
   * 目次・reorder・スモーク検証のdragを処理し、呼び出し側へ結果または副作用を返す。
   * @param sourceHeading - 目次・reorder・スモーク検証で扱う文字列または本文。
   * @param targetHeading - 目次・reorder・スモーク検証へ渡す入力。
   * @returns 目次・reorder・スモーク検証のdragが生成する結果。
   */ async (sourceHeading, targetHeading) => {
    const items = page.locator('.outline-item');
    const source = await items.nth(await outlineIndex(sourceHeading)).boundingBox();
    const target = await items.nth(await outlineIndex(targetHeading)).boundingBox();
    if (!source || !target) throw new Error(`Could not locate drag target: ${sourceHeading} -> ${targetHeading}`);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.75);
    await page.mouse.up({ button: 'right' });
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
     * @returns 条件を満たした要素だけを含む一覧。
     */
    (message) => message.type === 'localChanges').length
  );

  
  const waitForHost = /**
   * 目次・reorder・スモーク検証が指定条件を満たすまで待機する。
   * @param expected - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
   * @returns 目次・reorder・スモーク検証のwait・for・hostが生成する結果。
   */ async (expected) => {
    try {
      await page.waitForFunction(
      /**
       * Host側の本文状態が完了条件を満たすまで待機する。
       * @param text - ブラウザー内で評価するコールバック。
       * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
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
   * 目次・reorder・スモーク検証が指定条件を満たすまで待機する。
   * @param expected - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
   * @returns 目次・reorder・スモーク検証のwait・for・outlineが生成する結果。
   */ (expected) => page.waitForFunction(
  /**
   * ブラウザー内に「.outline-item」が現れるまで待機する。
   * @param items - ブラウザー内で評価するコールバック。
   * @returns 目次・reorder・スモーク検証のコールバックが生成する結果。
   */
  (items) => (
    [...document.querySelectorAll('.outline-item')].map(
    /**
     * 各要素からtext・contentを取り出して一覧化する。
     * @param element - 要素のtext・contentを参照する走査対象。
     * @returns text・contentを取り出した変換結果の一覧。
     */
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
   * @param expected - 目次・reorder・スモーク検証の位置・寸法・件数・時間を表す数値。
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
      'ribbon-undo-redo'
    ]
  }));
} finally {
  await browser.close();
}
