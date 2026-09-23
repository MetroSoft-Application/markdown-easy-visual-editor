/**
 * @file ribbonDefinitionTypes.ts
 * 実行境界: Webview。
 * 責務: 編集UI、プレビュー、ユーザー操作を処理する。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: DOM、Webviewメッセージ、ブラウザーAPI、編集状態を操作する。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
import type {
  RibbonContainerId,
  RibbonGroupId,
  RibbonHeaderGroupId,
  RibbonHeaderItemId,
  RibbonItemId,
  RibbonTabId,
} from "./ribbonIds";

/**
 * 「RibbonLabelSpec」として扱う値の型を定義します。
 */
export type RibbonLabelSpec =
  | {
  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  kind: "message";
  /**
   * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  path: string }
  | {
  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  kind: "messageWithNumber";
  /**
   * 「path」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
   */
  path: string;
  /**
   * 「value」は、位置・サイズ・件数などを表す数値です。
   */
  value: number }
  | {
  /**
   * 「kind」は、対象の識別や処理分岐に使用する値を保持します。
   */
  kind: "localized";
  /**
   * 「japanese」は、対象の内容または識別子を表す文字列です。
   */
  japanese: string;
  /**
   * 「english」は、対象の内容または識別子を表す文字列です。
   */
  english: string };

/**
 * 「RibbonButtonOptions」が満たすデータ契約を定義します。
 */
export interface RibbonButtonOptions {

  /**
   * 「shortcut」は、対象の内容または識別子を表す文字列です。
   */
  readonly shortcut?: string;

  /**
   * 「variant」は、関連処理が共有する構造化データの一項目です。
   */
  readonly variant?: "tool" | "source" | "header";

  /**
   * 「title」は、画面または通知へ表示する文言を保持します。
   */
  readonly title?: RibbonLabelSpec;
}

/**
 * 「RibbonControlFieldDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonControlFieldDefinition {

  /**
   * 「id」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly id: string;

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  readonly label: RibbonLabelSpec;

  /**
   * 「placeholder」は、関連処理が共有する構造化データの一項目です。
   */
  readonly placeholder?: RibbonLabelSpec;

  /**
   * 「min」は、位置・サイズ・件数などを表す数値です。
   */
  readonly min?: number;

  /**
   * 「max」は、位置・サイズ・件数などを表す数値です。
   */
  readonly max?: number;
}

/**
 * 「RibbonControlChoiceDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonControlChoiceDefinition {

  /**
   * 「value」は、対象の内容または識別子を表す文字列です。
   */
  readonly value: string;

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  readonly label: RibbonLabelSpec;
}

/**
 * 「RibbonControlOptions」が満たすデータ契約を定義します。
 */
export interface RibbonControlOptions {

  /**
   * 「values」は、関連する複数の対象または識別子を保持します。
   */
  readonly values?: readonly string[];

  /**
   * 「fields」は、関連する複数の対象または識別子を保持します。
   */
  readonly fields?: readonly RibbonControlFieldDefinition[];

  /**
   * 「choices」は、関連する複数の対象または識別子を保持します。
   */
  readonly choices?: readonly RibbonControlChoiceDefinition[];

  /**
   * 「hint」は、関連処理が共有する構造化データの一項目です。
   */
  readonly hint?: RibbonLabelSpec;
}

/**
 * 「RibbonItemDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonItemDefinition {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  readonly label: RibbonLabelSpec;

  /**
   * 「options」は、利用側が共有する設定または現在状態を保持します。
   */
  readonly options?: RibbonButtonOptions & RibbonControlOptions;

  /**
   * 「container」は、関連処理が共有する構造化データの一項目です。
   */
  readonly container?: RibbonContainerId;
}

/**
 * 「RibbonGroupDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonGroupDefinition {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  readonly label: RibbonLabelSpec;

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly className?: string;
}

/**
 * 「RibbonContainerDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonContainerDefinition {

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly className: string;

  /**
   * 「ariaLabel」は、画面または通知へ表示する文言を保持します。
   */
  readonly ariaLabel: RibbonLabelSpec;
}

/**
 * 「RibbonHeaderGroupDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonHeaderGroupDefinition {

  /**
   * 「className」は、対象の識別や処理分岐に使用する値を保持します。
   */
  readonly className: string;

  /**
   * 「ariaLabel」は、画面または通知へ表示する文言を保持します。
   */
  readonly ariaLabel: RibbonLabelSpec;
}

/**
 * 「RibbonHeaderItemDefinition」が満たすデータ契約を定義します。
 */
export interface RibbonHeaderItemDefinition {

  /**
   * 「label」は、画面または通知へ表示する文言を保持します。
   */
  readonly label: RibbonLabelSpec;

  /**
   * 「collapsedLabel」は、画面または通知へ表示する文言を保持します。
   */
  readonly collapsedLabel?: RibbonLabelSpec;

  /**
   * 「expandedLabel」は、画面または通知へ表示する文言を保持します。
   */
  readonly expandedLabel?: RibbonLabelSpec;

  /**
   * 「options」は、利用側が共有する設定または現在状態を保持します。
   */
  readonly options?: RibbonButtonOptions;

  /**
   * 「group」は、関連処理が共有する構造化データの一項目です。
   */
  readonly group?: RibbonHeaderGroupId;
}

/**
 * 「RibbonDefinitions」が満たすデータ契約を定義します。
 */
export interface RibbonDefinitions {

  /**
   * 「tabs」は、関連する複数の対象または識別子を保持します。
   */
  readonly tabs: Record<RibbonTabId, RibbonLabelSpec>;

  /**
   * 「groups」は、関連する複数の対象または識別子を保持します。
   */
  readonly groups: Record<RibbonGroupId, RibbonGroupDefinition>;

  /**
   * 「items」は、関連する複数の対象または識別子を保持します。
   */
  readonly items: Record<RibbonItemId, RibbonItemDefinition>;

  /**
   * 「containers」は、関連する複数の対象または識別子を保持します。
   */
  readonly containers: Record<RibbonContainerId, RibbonContainerDefinition>;

  /**
   * 「headerItems」は、関連する複数の対象または識別子を保持します。
   */
  readonly headerItems: Record<RibbonHeaderItemId, RibbonHeaderItemDefinition>;

  /**
   * 「headerGroups」は、関連する複数の対象または識別子を保持します。
   */
  readonly headerGroups: Record<
    RibbonHeaderGroupId,
    RibbonHeaderGroupDefinition
  >;

  /**
   * 「tabListLabel」は、画面または通知へ表示する文言を保持します。
   */
  readonly tabListLabel: RibbonLabelSpec;
}
