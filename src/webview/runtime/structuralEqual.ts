/**
 * @fileoverview Host から届く設定のような JSON 互換の値を、参照ではなく内容で比較する関数。
 * 実行境界: Webview（共有ロジックとして Node のテストからも使う）。
 * 目的: 内容が同じ設定で state を置き換えると、React の再レンダーと、設定を依存に持つ effect（プレビュー・Mermaid など）が無駄に再実行される。
 * 前の値を再利用できるかをここで判定する。
 * 不変条件: キーの有無も区別する（値が undefined のキーと、キーが無い状態は別物として扱う）。比較対象はプレーンオブジェクト・配列・プリミティブに限る。
 */

/**
 * 2つの値が構造的に等しいかを判定する。
 * プリミティブは Object.is で比べるため、NaN 同士は等しく、+0 と -0 は異なる。
 * プレーンオブジェクトは自身の列挙可能キーの集合と各値を、配列は長さと各要素を再帰的に比べる。
 * それ以外のオブジェクト（Date・Map・クラスインスタンスなど）は、同一参照の場合だけ等しいとみなす。誤って等しいと判定しないための安全側の扱い。
 * @param left - 比較する値。
 * @param right - 比較する値。
 * @returns 内容が等しい場合は true。
 */
export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every(
      /**
       * 同じ位置の要素同士を比べる。
       * @param item - 左側配列の要素。
       * @param index - 要素の位置。
       * @returns 要素が等しければ true。
       */
      (item, index) => structurallyEqual(item, right[index]),
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    /**
     * 同名キーが右側にも存在し、値が等しいかを確認する。
     * @param key - 左側オブジェクトのキー。
     * @returns キーが存在し値が等しければ true。
     */
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      structurallyEqual(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ),
  );
}

/**
 * 内容が前の値と等しければ前の値（同じ参照）を、異なれば次の値を返す。React の state 更新で再レンダーを避けるために使う。
 * @param previous - 現在保持している値。
 * @param next - 新しく受け取った値。
 * @returns 等しい場合は previous、異なる場合は next。
 */
export function reuseIfStructurallyEqual<T>(previous: T, next: T): T {
  return structurallyEqual(previous, next) ? previous : next;
}

/**
 * プロトタイプが Object.prototype または null のオブジェクトかを判定する。
 * @param value - 判定するオブジェクト。
 * @returns プレーンオブジェクトなら true。
 */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
