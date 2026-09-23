/**
 * @file ribbonLayoutTypes.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */

import type {
  RibbonGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

export type {
  RibbonContainerId,
  RibbonGroupId,
  RibbonHeaderButtonId,
  RibbonHeaderGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

/**
 * 「RibbonGroupLayout」が満たすデータ契約を定義します。
 */
export interface RibbonGroupLayout {

  /**
   * 「id」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly id: RibbonGroupId;

  /**
   * 「itemIds」は、関連する複数の対象または識別子を保持します。
   */
  readonly itemIds: readonly RibbonItemId[];
}

/**
 * 「RibbonTabLayout」が満たすデータ契約を定義します。
 */
export interface RibbonTabLayout {

  /**
   * 「id」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly id: RibbonTabId;

  /**
   * 「groups」は、関連する複数の対象または識別子を保持します。
   */
  readonly groups: readonly RibbonGroupLayout[];
}

/**
 * 「RibbonHeaderLayout」が満たすデータ契約を定義します。
 */
export interface RibbonHeaderLayout {

  /**
   * 「itemIds」は、関連する複数の対象または識別子を保持します。
   */
  readonly itemIds: readonly RibbonHeaderItemId[];
}

/**
 * 「RibbonLayoutDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonLayoutDefinition {

  /**
   * 「tabs」は、関連する複数の対象または識別子を保持します。
   */
  readonly tabs: readonly RibbonTabLayout[];

  /**
   * 「header」は、関連処理が共有する構造化データの一項目です。
   */
  readonly header: RibbonHeaderLayout;
}
