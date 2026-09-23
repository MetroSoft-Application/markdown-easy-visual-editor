/**
 * @fileoverview リボン配置のグループ、項目、表示条件を表す型を定義する。
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
 * リボン配置型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonGroupLayout {

    /**
     * リボン配置型のidに関する状態または設定。
     */
    readonly id: RibbonGroupId;

    /**
     * リボン配置型で扱うitem・idsの一覧。
     */
    readonly itemIds: readonly RibbonItemId[];
}

/**
 * リボン配置型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonTabLayout {

    /**
     * リボン配置型のidに関する状態または設定。
     */
    readonly id: RibbonTabId;

    /**
     * リボン配置型のgroupsに関する状態または設定。
     */
    readonly groups: readonly RibbonGroupLayout[];
}

/**
 * リボン配置型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonHeaderLayout {

    /**
     * リボン配置型で扱うitem・idsの一覧。
     */
    readonly itemIds: readonly RibbonHeaderItemId[];
}

/**
 * リボン配置型で共有するデータ形状を表すインターフェース。
 */
export interface RibbonLayoutDefinition {

    /**
     * リボン配置型のtabsに関する状態または設定。
     */
    readonly tabs: readonly RibbonTabLayout[];

    /**
     * リボン配置型のheaderに関する状態または設定。
     */
    readonly header: RibbonHeaderLayout;
}
