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
         * 検証・変換・保存の対象となる値。
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
 * リボン定義型で共有するデータ形状を表すインターフェース。
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
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonControlChoiceDefinition {

    /**
     * 検証・変換・保存の対象となる値。
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
     * リボン定義型のfieldsに関する状態または設定。
     */
    readonly fields?: readonly RibbonControlFieldDefinition[];

    /**
     * 選択コントロールへ表示する候補の一覧。
     */
    readonly choices?: readonly RibbonControlChoiceDefinition[];

    /**
     * リボン定義型のhintに関する状態または設定。
     */
    readonly hint?: RibbonLabelSpec;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
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
     * リボン定義型のcontainerに関する状態または設定。
     */
    readonly container?: RibbonContainerId;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonGroupDefinition {

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * リボン定義型で扱うclass・nameの文字列。
     */
    readonly className?: string;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonContainerDefinition {

    /**
     * リボン定義型で扱うclass・nameの文字列。
     */
    readonly className: string;

    /**
     * 図の内容を補足するアクセシビリティ用ラベル。
     */
    readonly ariaLabel: RibbonLabelSpec;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonHeaderGroupDefinition {

    /**
     * リボン定義型で扱うclass・nameの文字列。
     */
    readonly className: string;

    /**
     * 図の内容を補足するアクセシビリティ用ラベル。
     */
    readonly ariaLabel: RibbonLabelSpec;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonHeaderItemDefinition {

    /**
     * 画面または検証結果に表示する説明文。
     */
    readonly label: RibbonLabelSpec;

    /**
     * リボン定義型の状態を示すフラグ。
     */
    readonly collapsedLabel?: RibbonLabelSpec;

    /**
     * リボン定義型のexpanded・labelに関する状態または設定。
     */
    readonly expandedLabel?: RibbonLabelSpec;

    /**
     * 呼び出し側が指定する処理設定。
     */
    readonly options?: RibbonButtonOptions;

    /**
     * リボン定義型のgroupに関する状態または設定。
     */
    readonly group?: RibbonHeaderGroupId;
}

/**
 * リボン定義型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonDefinitions {

    /**
     * リボン定義型のtabsに関する状態または設定。
     */
    readonly tabs: Record<RibbonTabId, RibbonLabelSpec>;

    /**
     * リボン定義型のgroupsに関する状態または設定。
     */
    readonly groups: Record<RibbonGroupId, RibbonGroupDefinition>;

    /**
     * リボン定義型で扱うitemsの一覧。
     */
    readonly items: Record<RibbonItemId, RibbonItemDefinition>;

    /**
     * リボン定義型のcontainersに関する状態または設定。
     */
    readonly containers: Record<RibbonContainerId, RibbonContainerDefinition>;

    /**
     * リボン定義型で扱うheader・itemsの一覧。
     */
    readonly headerItems: Record<RibbonHeaderItemId, RibbonHeaderItemDefinition>;

    /**
     * リボン定義型のheader・groupsに関する状態または設定。
     */
    readonly headerGroups: Record<
        RibbonHeaderGroupId,
        RibbonHeaderGroupDefinition
    >;

    /**
     * リボン定義型のtab・list・labelに関する状態または設定。
     */
    readonly tabListLabel: RibbonLabelSpec;
}
