import type { TextChange } from './protocol';
import { getMessages } from './messages';

export type { TextChange } from './protocol';

/**
 * 変更前後の本文から、共通部分を除いた単一のテキスト変更を計算する。
 * @param before 変更前の本文。
 * @param after 変更後の本文。
 * @returns 差分がない場合は空配列、それ以外は本文中央の置換を表す変更。
 */
export function computeTextChanges(before: string, after: string): TextChange[] {
// 先頭と末尾の共通部分を除外し、中央の差分を1件の置換として返す。
    if (before === after) return [];
    let prefix = 0;
    const maximumPrefix = Math.min(before.length, after.length);
    while (prefix < maximumPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;

    let beforeSuffix = before.length;
    let afterSuffix = after.length;
    while (
        beforeSuffix > prefix
        && afterSuffix > prefix
        && before.charCodeAt(beforeSuffix - 1) === after.charCodeAt(afterSuffix - 1)
    ) {
        // 末尾から一致する文字を詰め、変更されている範囲だけを残す。
        beforeSuffix -= 1;
        afterSuffix -= 1;
    }

    return [{
        rangeOffset: prefix,
        rangeLength: beforeSuffix - prefix,
        text: after.slice(prefix, afterSuffix)
    }];
}

    /**
     * 本文へ複数のテキスト変更を適用し、変更後の本文を返す。
     * @param value 変更を適用する本文。
     * @param changes 本文上の変更一覧。
     * @returns 変更適用後の本文。
     * @throws {RangeError} 変更範囲が本文に対して不正な場合。
     */
export function applyTextChanges(value: string, changes: readonly TextChange[]): string {
    // 変更範囲を検証して後方位置から適用し、前方のオフセットをずらさない。
    validateTextChanges(changes, value.length);
    let result = value;
    for (const change of [...changes].sort((left, right) => right.rangeOffset - left.rangeOffset)) {
        result = result.slice(0, change.rangeOffset)
            + change.text
            + result.slice(change.rangeOffset + change.rangeLength);
    }
    return result;
}

    /**
     * 別の変更が適用された後の本文位置へ、テキスト変更の範囲を写像する。
     * @param changes 写像対象の変更一覧。
     * @param over 先に適用された変更一覧。
     * @param baseLength 両方の変更が基準とする本文の長さ。
     * @param before 同一位置の挿入を写像前側へ寄せるかどうか。
     * @returns 変更後の本文に対応する変更一覧。
     * @throws {Error} 変更範囲が重なって安全に写像できない場合。
     * @throws {RangeError} 変更範囲が基準本文に対して不正な場合。
     */
export function mapTextChanges(
    changes: readonly TextChange[],
    over: readonly TextChange[],
    baseLength: number,
    before = false
): TextChange[] {
    // 同じ基準本文に対する変更を検証し、重なりを検出しながら別の変更後の位置へ写像する。
    if (!changes.length) return [];
    if (!over.length) return changes.map((change) => ({ ...change }));
    validateTextChanges(changes, baseLength);
    validateTextChanges(over, baseLength);
    const remote = [...over].sort((left, right) => left.rangeOffset - right.rangeOffset);
    return [...changes]
        .sort((left, right) => left.rangeOffset - right.rangeOffset)
        .map((change) => {
    // 現在の変更とリモート変更の範囲が重なる場合は、安全に統合できないため失敗させる。
            const start = change.rangeOffset;
            const end = start + change.rangeLength;
            for (const other of remote) {
                const otherStart = other.rangeOffset;
                const otherEnd = otherStart + other.rangeLength;
                if (change.rangeLength === 0 && other.rangeLength === 0) continue;
                if (change.rangeLength === 0) {
                    if (start > otherStart && start < otherEnd) throw new Error(getMessages('en').internal.concurrentEditsOverlap);
                    continue;
                }
                if (other.rangeLength === 0) {
                    if (otherStart > start && otherStart < end) throw new Error(getMessages('en').internal.concurrentEditsOverlap);
                    continue;
                }
                if (Math.max(start, otherStart) < Math.min(end, otherEnd)) throw new Error(getMessages('en').internal.concurrentEditsOverlap);
            }

            if (change.rangeLength === 0) {
            // 挿入位置は、前にある変更の長さを加算して新しい位置へ移す。
                let mapped = start;
                for (const other of remote) {
                    const otherEnd = other.rangeOffset + other.rangeLength;
                    if (other.rangeLength === 0 && other.rangeOffset === start) {
                        if (!before) mapped += other.text.length;
                    } else if (otherEnd <= start) {
                        mapped += other.text.length - other.rangeLength;
                    }
                }
                return { ...change, rangeOffset: mapped };
            }

            let mappedStart = start;
            let mappedEnd = end;
            // 置換範囲の前後にある変更量を加算して、開始・終了位置をそれぞれ移動する。
            for (const other of remote) {
                const delta = other.text.length - other.rangeLength;
                const otherEnd = other.rangeOffset + other.rangeLength;
                if (other.rangeLength === 0) {
                    if (other.rangeOffset <= start) mappedStart += delta;
                    if (other.rangeOffset < end) mappedEnd += delta;
                } else {
                    if (otherEnd <= start) mappedStart += delta;
                    if (otherEnd <= end) mappedEnd += delta;
                }
            }
            return { ...change, rangeOffset: mappedStart, rangeLength: mappedEnd - mappedStart };
        });
}

        /**
         * 変更一覧を通して、本文上の単一オフセットを変更後の位置へ写像する。
         * @param offset 変更前本文上のオフセット。
         * @param changes 適用済みまたは適用予定の変更一覧。
         * @param baseLength 変更前本文の長さ。
         * @param association 境界位置を前側または後側のどちらへ関連付けるか。
         * @returns 変更後本文上のオフセット。
         * @throws {RangeError} オフセットまたは変更範囲が不正な場合。
         */
export function mapTextOffset(
    offset: number,
    changes: readonly TextChange[],
    baseLength: number,
    association: -1 | 1 = 1
): number {
        // 単一オフセットを変更後の本文位置へ変換し、境界上の所属方向をassociationで選ぶ。
    if (!Number.isInteger(offset) || offset < 0 || offset > baseLength) {
        throw new RangeError(`Invalid text offset: ${offset}`);
    }
    if (!changes.length) return offset;
    validateTextChanges(changes, baseLength);
    let mapped = offset;
    for (const change of [...changes].sort((left, right) => left.rangeOffset - right.rangeOffset)) {
    // オフセットより前の変更量を反映し、変更範囲内なら対応する境界へ移す。
        const end = change.rangeOffset + change.rangeLength;
        if (offset < change.rangeOffset) break;
        if (change.rangeLength === 0 && offset === change.rangeOffset) {
            if (association > 0) mapped += change.text.length;
        } else if (offset >= end) {
            mapped += change.text.length - change.rangeLength;
        } else {
            mapped = change.rangeOffset + (association < 0 ? 0 : change.text.length);
            break;
        }
    }
    return mapped;
}

    /**
     * テキスト変更の範囲が整数・本文内・非重複になっていることを検証する。
     * @param changes 検証対象の変更一覧。
     * @param baseLength 変更の基準となる本文の長さ。
     * @returns 検証に成功した場合は何も返さない。
     * @throws {RangeError} 位置・長さ・本文境界・重複のいずれかが不正な場合。
     */
export function validateTextChanges(changes: readonly TextChange[], baseLength: number): void {
    // 変更の位置・長さ・基準本文からのはみ出し・相互の重なりを検証する。
    let previousEnd = 0;
    for (const [index, change] of [...changes].sort((left, right) => left.rangeOffset - right.rangeOffset).entries()) {
        if (
            !Number.isInteger(change.rangeOffset)
            || !Number.isInteger(change.rangeLength)
            || change.rangeOffset < 0
            || change.rangeLength < 0
            || change.rangeOffset + change.rangeLength > baseLength
        ) {
            throw new RangeError(`Invalid text change at index ${index}`);
        }
        if (change.rangeOffset < previousEnd) throw new RangeError(`Overlapping text change at index ${index}`);
        previousEnd = change.rangeOffset + change.rangeLength;
    }
}
