/**
 * @fileoverview 値の反映を遅延し、保留中の反映を取り消せる React フック。
 * Webview のプレビュー更新頻度を抑えるために使い、アンマウント時にタイマーを必ず解除する。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 値の更新を待ち時間後に反映し、必要なら保留中の反映を取り消せる状態を管理する。
 * @param value - 遅延反映する入力値。
 * @param delay - 確定値を反映するまで待つ時間（ミリ秒）。
 * @returns 遅延反映後の値と、未確定タイマーを取り消す関数。
 */
export function useInterruptibleDebouncedValue<T>(
  value: T,
  delay: number,
): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const initialValueRef = useRef(value);
  const firstNonInitialValueRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const idleHandleRef = useRef<number | undefined>(undefined);
  const idleUsesTimeoutRef = useRef(false);
  const generationRef = useRef(0);

  const cancelPending = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (idleHandleRef.current !== undefined) {
      const idleWindow = window as Window & {
        /**
         * requestIdleCallback で登録したアイドルコールバックを取り消す。
         * @param handle - requestIdleCallbackが返した、取り消すアイドルコールバックID。
         * @returns 戻り値はなく、指定したidle callbackを取り消す。
         */
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idleUsesTimeoutRef.current || !idleWindow.cancelIdleCallback) {
        window.clearTimeout(idleHandleRef.current);
      } else {
        idleWindow.cancelIdleCallback(idleHandleRef.current);
      }
      idleHandleRef.current = undefined;
    }
  }, []);

  useEffect(
    /**
     * 依存状態の変化に応じて表示または購読を更新する。
     */
    () => {
      if (!firstNonInitialValueRef.current && value === initialValueRef.current)
        return;
      // 初回のホスト文書だけは起動時の表示を遅らせない。
      if (!firstNonInitialValueRef.current) {
        firstNonInitialValueRef.current = true;
        setDebounced(value);
        return;
      }
      cancelPending();
      const generation = generationRef.current;
      timerRef.current = window.setTimeout(
        /**
         * 指定時間の経過後に後続処理を実行する。
         */
        () => {
          timerRef.current = undefined;

          const commit = /**
           * 世代番号が一致する場合に遅延本文を確定する。

           */ () => {
            idleHandleRef.current = undefined;
            if (generation !== generationRef.current) return;
            setDebounced(value);
          };
          const idleWindow = window as Window & {
            /**
             * アイドル時または上限時間の経過後にコールバックを実行するブラウザーAPI。
             * @param callback - 実行を予約するアイドル処理。
             * @param options - 強制実行までの最大待機時間を指定する設定。
             * @returns 予約した処理の識別番号。
             */
            requestIdleCallback?: (
              callback: () => void,
              options?: {
                /** アイドル処理を強制実行するまでの最大待機時間（ミリ秒）。 */
                timeout: number;
              },
            ) => number;
          };
          if (idleWindow.requestIdleCallback) {
            idleUsesTimeoutRef.current = false;
            idleHandleRef.current = idleWindow.requestIdleCallback(commit, {
              timeout: 750,
            });
          } else {
            idleUsesTimeoutRef.current = true;
            idleHandleRef.current = window.setTimeout(commit, 0);
          }
        },
        delay,
      );
      return cancelPending;
    },
    [value, delay, cancelPending],
  );

  return [debounced, cancelPending];
}
