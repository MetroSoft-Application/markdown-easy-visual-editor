/**
 * @fileoverview リンク先補完の候補要求を Host へ送り、requestId で応答を対応付ける Webview 側のクライアント。
 * 応答が一定時間内に来ない場合や破棄後は undefined で解決し、補完の待機が残らないようにする。
 * 遅れて届いた応答（タイムアウト後・破棄後）は無視する。タイマーは応答・タイムアウト・破棄のいずれかで必ず解除する。
 */
import type {
  HostToWebviewMessage,
  LinkCompletionFile,
  LinkCompletionHeading,
  WebviewToHostMessage,
} from "../../shared/protocol";
import { useEffect, useRef, useState } from "react";
import { createClientId } from "../runtime/id";

/** Host からのリンク先補完の応答メッセージ。 */
type LinkCompletionsMessage = Extract<HostToWebviewMessage, { type: "linkCompletions" }>;

/** 応答を待つ時間。入力中の補完なので、遅い場合は候補なしとして扱う。 */
const LINK_COMPLETION_TIMEOUT_MS = 3000;

/** リンク先補完の要求と応答を管理するクライアント。 */
export interface LinkCompletionClient {
  /**
   * 文書からリンクできるファイルの候補を要求する。
   * @returns 候補一覧。タイムアウト・破棄後はundefined。
   */
  requestFiles: () => Promise<LinkCompletionFile[] | undefined>;
  /**
   * 指定した文書の見出し候補を要求する。
   * @param path - 本文に書かれたとおりのリンク先パス（`#` より前）。
   * @returns 見出し一覧。タイムアウト・破棄後はundefined。
   */
  requestHeadings: (path: string) => Promise<LinkCompletionHeading[] | undefined>;
  /**
   * Host からの応答を、対応する要求へ渡す。対応する要求がない応答は無視する。
   * @param message - linkCompletions メッセージ。
   */
  accept: (message: LinkCompletionsMessage) => void;
  /** 待機中の要求をすべて undefined で解決し、タイマーを解除する。以後の要求も即座に undefined で解決する。 */
  dispose: () => void;
}

/** 応答待ちの要求1件。 */
interface PendingRequest {
  /** 応答または打ち切りで呼ぶ解決関数。 */
  resolve: (message: LinkCompletionsMessage | undefined) => void;
  /** タイムアウトのタイマーID。 */
  timer: number;
}

/**
 * リンク先補完のクライアントを作る。
 * @param post - Host へメッセージを送る関数。
 * @param timeoutMs - 応答を待つ時間（ミリ秒）。既定は3000。
 * @returns 要求・応答の受け渡しと破棄を行うクライアント。
 */
export function createLinkCompletionClient(
  post: (message: WebviewToHostMessage) => void,
  timeoutMs = LINK_COMPLETION_TIMEOUT_MS,
): LinkCompletionClient {
  const pending = new Map<string, PendingRequest>();
  let disposed = false;

  /**
   * 要求を送り、応答またはタイムアウトで解決する Promise を返す。
   * @param kind - 要求の種類。
   * @param path - headings 要求の対象パス。
   * @returns 応答メッセージ。タイムアウト・破棄後はundefined。
   */
  const request = (kind: "paths" | "headings", path?: string): Promise<LinkCompletionsMessage | undefined> => {
    if (disposed) return Promise.resolve(undefined);
    const requestId = createClientId();
    return new Promise(
      /**
       * 応答待ちとして登録し、要求を送る。
       * @param resolve - 応答またはタイムアウトで呼ぶ解決関数。
       */
      (resolve) => {
      const timer = window.setTimeout(
        /** 応答が来なかった要求を打ち切る。 */
        () => {
          pending.delete(requestId);
          resolve(undefined);
        },
        timeoutMs);
      pending.set(requestId, { resolve, timer });
      post({ type: "requestLinkCompletions", requestId, kind, ...(path === undefined ? {} : { path }) });
    });
  };

  return {
    /**
     * ファイル候補を要求する。
     * @returns 候補一覧。タイムアウト・破棄後はundefined。
     */
    requestFiles: async () => (await request("paths"))?.paths,
    /**
     * 見出し候補を要求する。
     * @param path - 本文に書かれたとおりのリンク先パス。
     * @returns 見出し一覧。タイムアウト・破棄後はundefined。
     */
    requestHeadings: async (path) => (await request("headings", path))?.headings,
    /**
     * 応答を対応する要求へ渡し、そのタイマーを解除する。
     * @param message - linkCompletions メッセージ。
     */
    accept: (message) => {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      window.clearTimeout(entry.timer);
      entry.resolve(message);
    },
    /** 待機中の要求を打ち切り、以後の要求を受け付けないようにする。 */
    dispose: () => {
      disposed = true;
      for (const entry of pending.values()) {
        window.clearTimeout(entry.timer);
        entry.resolve(undefined);
      }
      pending.clear();
    },
  };
}

/** React から使うリンク先補完の窓口。参照は描画をまたいで変わらない。 */
export type LinkCompletionHandle = Pick<LinkCompletionClient, "requestFiles" | "requestHeadings" | "accept">;

/**
 * マウント中だけ有効なリンク先補完クライアントを提供するフック。
 * クライアントは effect 内で作って後始末で破棄するため、StrictMode の再マウントでも新しいクライアントで動き続ける。
 * マウント前・アンマウント後の要求は undefined で解決し、応答は無視する。
 * @param post - Host へメッセージを送る関数。最初の描画で渡された関数を使い続ける。
 * @returns 要求と応答受け渡しの窓口。
 */
export function useLinkCompletionClient(post: (message: WebviewToHostMessage) => void): LinkCompletionHandle {
  const clientRef = useRef<LinkCompletionClient | undefined>(undefined);
  const postRef = useRef(post);
  useEffect(
    /**
     * クライアントを作り、アンマウント時に破棄する。
     * @returns 待機中の要求とタイマーを解除する後始末。
     */
    () => {
      const client = createLinkCompletionClient(postRef.current);
      clientRef.current = client;
      return () => {
        client.dispose();
        if (clientRef.current === client) clientRef.current = undefined;
      };
    },
    [],
  );
  const [handle] = useState<LinkCompletionHandle>(
    /**
     * 現在のクライアントへ委ねる窓口を作る。
     * @returns 描画をまたいで同じ参照の窓口。
     */
    () => ({
      /**
       * ファイル候補を要求する。
       * @returns 候補一覧。クライアントがなければundefined。
       */
      requestFiles: async () => clientRef.current?.requestFiles(),
      /**
       * 見出し候補を要求する。
       * @param path - 本文に書かれたとおりのリンク先パス。
       * @returns 見出し一覧。クライアントがなければundefined。
       */
      requestHeadings: async (path) => clientRef.current?.requestHeadings(path),
      /**
       * 応答を現在のクライアントへ渡す。
       * @param message - linkCompletions メッセージ。
       */
      accept: (message) => clientRef.current?.accept(message),
    }),
  );
  return handle;
}
