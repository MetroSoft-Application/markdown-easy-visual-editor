/**
 * @fileoverview リボン項目の種類、表示条件、実行契約を型で表す。
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
 * リボン表示文言を共有メッセージキーで表す型。
 */
export type RibbonLabelSpec =
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: "message";
        /**
         * 読み書きするファイルまたはリソースの場所。
         */
        path: string
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: "messageWithNumber";
        /**
         * 読み書きするファイルまたはリソースの場所。
         */
        path: string;
        /**
         * メッセージ内の数値プレースホルダーへ渡す値。
         */
        value: number
    };

/**
 * リボン定義型へ渡す設定項目と既定値のデータ形状。
 */
export interface RibbonButtonOptions {

    /**
     * リボン項目に割り当てるキーボードショートカット。
     */
    readonly shortcut?: string;

    /**
     * リボン項目の表示種別。
     */
    readonly variant?: "tool" | "source" | "header";

    /**
     * 画面や出力に表示するタイトル。
     */
    readonly title?: RibbonLabelSpec;
}

/**
 * リボン入力コントロールの項目名、初期値、属性定義です。
 */
export interface RibbonControlFieldDefinition {

    /**
     * リボン定義型で扱うidの文字列。
     */
    readonly id: string;

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * 入力欄に値がないときに表示する案内文。
     */
    readonly placeholder?: RibbonLabelSpec;

    /**
     * 入力または寸法に許可する下限値。
     */
    readonly min?: number;

    /**
     * 入力または寸法に許可する上限値。
     */
    readonly max?: number;
}

/**
 * 選択式リボンコントロールの表示名と値です。
 */
export interface RibbonControlChoiceDefinition {

    /**
     * 選択時にコントロールから返す選択肢ID文字列。
     */
    readonly value: string;

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;
}

/**
 * リボン定義型へ渡す設定項目と既定値のデータ形状。
 */
export interface RibbonControlOptions {

    /**
     * リボン定義型で扱うvaluesの一覧。
     */
    readonly values?: readonly string[];

    /**
     * このcontrolが受け取る入力欄のID・表示名・範囲を定義する一覧。
     */
    readonly fields?: readonly RibbonControlFieldDefinition[];

    /**
     * 選択コントロールへ表示する候補の一覧。
     */
    readonly choices?: readonly RibbonControlChoiceDefinition[];

    /**
     * controlの下に表示する補足または入力条件の説明。
     */
    readonly hint?: RibbonLabelSpec;
}

/**
 * リボン上のボタンまたは選択項目の表示と動作定義です。
 */
export interface RibbonItemDefinition {

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * 呼び出し側が指定する処理設定。
     */
    readonly options?: RibbonButtonOptions & RibbonControlOptions;

    /**
     * 項目を配置するリボン上の領域ID。省略時は既定領域を使う。
     */
    readonly container?: RibbonContainerId;
}

/**
 * タブ内に並べるリボン項目のグループ定義です。
 */
export interface RibbonGroupDefinition {

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * このgroupの要素に付与するレイアウト用CSS class。
     */
    readonly className?: string;
}

/**
 * タブとヘッダーに表示するリボン群の定義です。
 */
export interface RibbonContainerDefinition {

    /**
     * このcontainerの配置とスタイルを選ぶCSS class。
     */
    readonly className: string;

    /**
     * 図の内容を補足するアクセシビリティ用ラベル。
     */
    readonly ariaLabel: RibbonLabelSpec;
}

/**
 * リボンヘッダーに並べる項目群の定義です。
 */
export interface RibbonHeaderGroupDefinition {

    /**
     * ヘッダーgroupの配置とスタイルを選ぶCSS class。
     */
    readonly className: string;

    /**
     * 図の内容を補足するアクセシビリティ用ラベル。
     */
    readonly ariaLabel: RibbonLabelSpec;
}

/**
 * リボンヘッダーに表示する単一項目の定義です。
 */
export interface RibbonHeaderItemDefinition {

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * リボン折り畳み時に表示する任意のラベル定義。
     */
    readonly collapsedLabel?: RibbonLabelSpec;

    /**
     * リボン展開時に項目へ表示する長いラベル。省略時はlabelを使う。
     */
    readonly expandedLabel?: RibbonLabelSpec;

    /**
     * 呼び出し側が指定する処理設定。
     */
    readonly options?: RibbonButtonOptions;

    /**
     * ヘッダー項目をまとめるgroup ID。省略時は個別配置する。
     */
    readonly group?: RibbonHeaderGroupId;
}

/**
 * 各タブとヘッダーで使用するリボン定義全体です。
 */
export interface RibbonDefinitions {

    /**
     * タブIDごとのローカライズ済み表示ラベル。
     */
    readonly tabs: Record<RibbonTabId, RibbonLabelSpec>;

    /**
     * group IDごとの見出しとレイアウト定義。
     */
    readonly groups: Record<RibbonGroupId, RibbonGroupDefinition>;

    /**
     * リボン項目IDをキーにした項目定義Record。
     */
    readonly items: Record<RibbonItemId, RibbonItemDefinition>;

    /**
     * container IDごとのCSS classとアクセシビリティラベル。
     */
    readonly containers: Record<RibbonContainerId, RibbonContainerDefinition>;

    /**
     * ヘッダー項目IDをキーにした項目定義Record。
     */
    readonly headerItems: Record<RibbonHeaderItemId, RibbonHeaderItemDefinition>;

    /**
     * ヘッダーgroup IDごとのCSS classとアクセシビリティラベル。
     */
    readonly headerGroups: Record<
        RibbonHeaderGroupId,
        RibbonHeaderGroupDefinition
    >;

    /**
     * タブ一覧ボタンに表示するローカライズ済みラベル。
     */
    readonly tabListLabel: RibbonLabelSpec;
}
