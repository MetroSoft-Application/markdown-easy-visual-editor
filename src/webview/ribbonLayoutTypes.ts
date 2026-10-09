/**
 * @fileoverview リボン配置のグループ、項目、表示条件を表す型を定義する。
 */
import type {
    RibbonGroupId,
    RibbonHeaderItemId,
    RibbonItemId,
    RibbonTabId,
} from "./ribbonIds";

/** リボン配置ファイル間で使うID型をまとめて再公開する。 */
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
 * リボングループの幅とタブ内配置位置です。
 */
export interface RibbonGroupLayout {

    /**
     * このグループを識別するID。
     */
    readonly id: RibbonGroupId;

    /**
     * このグループに表示するリボン項目IDの順序付き一覧。
     */
    readonly itemIds: readonly RibbonItemId[];
}

/**
 * タブ内のグループ順と各グループの配置です。
 */
export interface RibbonTabLayout {

    /**
     * このタブを識別するID。
     */
    readonly id: RibbonTabId;

    /**
     * タブ内に表示するグループとその順序。
     */
    readonly groups: readonly RibbonGroupLayout[];
}

/**
 * ヘッダー領域の幅と項目配置です。
 */
export interface RibbonHeaderLayout {

    /**
     * ヘッダーに表示するリボン項目IDの順序付き一覧。
     */
    readonly itemIds: readonly RibbonHeaderItemId[];
}

/**
 * タブとヘッダーを含むリボン全体の配置定義です。
 */
export interface RibbonLayoutDefinition {

    /**
     * リボン内のタブとその表示順。
     */
    readonly tabs: readonly RibbonTabLayout[];

    /**
     * タブ外に固定表示するヘッダー項目の配置。
     */
    readonly header: RibbonHeaderLayout;
}
