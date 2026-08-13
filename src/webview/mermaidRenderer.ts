import mermaid from 'mermaid';
import { createClientId } from './id';
import { getMessages, type SupportedLanguage } from '../shared/messages';

export type MermaidTheme = 'default' | 'dark' | 'neutral';

let mermaidQueue: Promise<void> = Promise.resolve();

/**
 * Mermaidソースを指定テーマでSVGへ変換し、共有設定を壊さないよう直列実行する。
 * @param source Mermaid記法のソース。
 * @param theme Mermaidへ適用するテーマ。
 * @returns 生成されたSVG文字列を解決するPromise。
 * @throws Mermaidの構文解析または描画に失敗した場合。
 */
export function renderMermaidSvg(source: string, theme: MermaidTheme): Promise<string> {
  // Mermaidの共有設定を順番に更新し、図をSVGへ変換する処理をキューで直列化する。
  let resolveResult!: (value: string) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  mermaidQueue = mermaidQueue
    .then(async () => {
      // 現在のテーマを設定して構文解析後にSVGを生成する。
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        suppressErrorRendering: true
      });
      await mermaid.parse(source);
      const { svg } = await mermaid.render(`mve-mermaid-${createClientId()}`, source);
      resolveResult(svg);
    })
    .catch((error) => rejectResult(error));

  return result;
}

/**
 * Mermaidの例外を行・列情報付きの画面表示用エラーメッセージへ変換する。
 * @param error Mermaidから受け取った例外または任意のエラー値。
 * @returns 画面表示用に整形したエラーメッセージ。
 */
export function mermaidErrorMessage(error: unknown, language: SupportedLanguage = 'ja'): string {
  // Mermaidのエラー文字列から行・列情報を抽出し、画面表示用の文面に整える。
  const message = error instanceof Error ? error.message : String(error);
  const location = /(?:line\s+(\d+))(?:[^\d]+(?:col(?:umn)?\s*)?(\d+))?/i.exec(message);
  const messages = getMessages(language);
  const prefix = location
    ? `${messages.renderer.mermaidError} (${messages.app.line(Number(location[1]))}${location[2] ? `, ${location[2]}` : ''})`
    : messages.renderer.mermaidError;
  return `${prefix}\n${message}`;
}
