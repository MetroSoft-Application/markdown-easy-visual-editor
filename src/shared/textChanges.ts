/**
 * @fileoverview 本文変更の範囲と順序を検証し、改行正規化後の座標へ安全に写像して適用する。
 */
import type { TextChange } from './protocol';
import { getMessages } from './messages';

/** HostとWebview間で共有する変更範囲の型を再公開する。 */
export type { TextChange } from './protocol';

/**
 * textchangesの寸法、容量、位置、または計測値を求める。
 * @param before - 差分計算前の本文文字列。
 * @param after - 差分計算後の本文文字列。
 * @returns beforeからafterへ変換する、元本文オフセット順のテキスト変更一覧。
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
 * textchangesで扱う値の種類と境界を表す型。
 */
type ComposedSegment =
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'original';
        /**
         * 変更前本文で保持する範囲の先頭UTF-16オフセットです。
         */
        from: number;
        /**
         * 変更前本文で保持する範囲の末尾UTF-16オフセットです。
         */
        to: number
    }
    | {
        /**
         * メッセージ、項目、または処理の種類を識別する値。
         */
        kind: 'inserted';
        /**
         * 表示・解析・変換の対象となる本文。
         */
        text: string
    };

/**
  * 同じ基準本文に対する2組の変更を、逐次適用した結果と等価な1組へ合成する。
 * @param first - 合成変更へ変換する先行テキスト変更一覧。
 * @param second - 先行変更の後に適用するテキスト変更一覧。
 * @param baseLength - 変更範囲を制限する基準本文のUTF-16長。
  * @returns 2組の変更を合成した、重複しない変更範囲一覧。
 */
export function composeTextChanges(
    first: readonly TextChange[],
    second: readonly TextChange[],
    baseLength: number
): TextChange[] {
    validateTextChanges(first, baseLength);
    const intermediateLength = baseLength + first.reduce(

        /**
         * 要素を順に加算して累積値を求める。
         * @param length - 累積値へ加算する要素。
         * @param change - 累積値へ加算する要素。
         * @returns 要素を集約した累積値。
         */
        (length, change) => length + change.text.length - change.rangeLength,
        0
    );
    validateTextChanges(second, intermediateLength);
    if (!first.length) return second.map(
        /**
         * secondの各要素を変換して一覧化する。
         * @param change - 本文上の1件の変更範囲。

         */
        (change) => ({ ...change }));
    if (!second.length) return first.map(
        /**
         * firstの各要素を変換して一覧化する。
         * @param change - 本文上の1件の変更範囲。

         */
        (change) => ({ ...change }));

    const segments: ComposedSegment[] = [];
    let cursor = 0;
    for (const change of [...first].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.rangeOffset - right.rangeOffset)) {
        if (cursor < change.rangeOffset) {
            segments.push({ kind: 'original', from: cursor, to: change.rangeOffset });
        }
        if (change.text) segments.push({ kind: 'inserted', text: change.text });
        cursor = change.rangeOffset + change.rangeLength;
    }
    if (cursor < baseLength) segments.push({ kind: 'original', from: cursor, to: baseLength });

    for (const change of [...second].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => right.rangeOffset - left.rangeOffset)) {
        const startIndex = splitComposedSegmentsAt(segments, change.rangeOffset);
        const endIndex = splitComposedSegmentsAt(segments, change.rangeOffset + change.rangeLength);
        segments.splice(
            startIndex,
            endIndex - startIndex,
            ...(change.text ? [{ kind: 'inserted' as const, text: change.text }] : [])
        );
        normalizeComposedSegments(segments);
    }

    const result: TextChange[] = [];
    let originalCursor = 0;
    let inserted = '';
    for (const segment of segments) {
        if (segment.kind === 'inserted') {
            inserted += segment.text;
            continue;
        }
        if (segment.from > originalCursor || inserted) {
            result.push({
                rangeOffset: originalCursor,
                rangeLength: segment.from - originalCursor,
                text: inserted
            });
        }
        originalCursor = segment.to;
        inserted = '';
    }
    if (originalCursor < baseLength || inserted) {
        result.push({
            rangeOffset: originalCursor,
            rangeLength: baseLength - originalCursor,
            text: inserted
        });
    }
    return result;
}

/**
  * 合成変更セグメントを指定オフセットで分割し、前半のセグメント数を返す。
 * @param segments - UTF-16オフセットで分割する合成変更セグメント一覧。
 * @param offset - 合成後の本文内で分割するUTF-16オフセット。
  * @returns 分割後の先頭側セグメント数。
 */
function splitComposedSegmentsAt(segments: ComposedSegment[], offset: number): number {
    let position = 0;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const length = segment.kind === 'original' ? segment.to - segment.from : segment.text.length;
        if (offset === position) return index;
        if (offset < position + length) {
            const local = offset - position;
            if (segment.kind === 'original') {
                segments.splice(index, 1,
                    { kind: 'original', from: segment.from, to: segment.from + local },
                    { kind: 'original', from: segment.from + local, to: segment.to });
            } else {
                segments.splice(index, 1,
                    { kind: 'inserted', text: segment.text.slice(0, local) },
                    { kind: 'inserted', text: segment.text.slice(local) });
            }
            return index + 1;
        }
        position += length;
    }
    if (offset === position) return segments.length;
    throw new RangeError(`Invalid composed text offset: ${offset}`);
}

/**
 * 隣接する変更セグメントを結合し、合成変更列を正規化する。
 * @param segments - 隣接区間を結合して正規化する合成変更セグメント一覧。
 */
function normalizeComposedSegments(segments: ComposedSegment[]): void {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        const empty = segment.kind === 'original' ? segment.from === segment.to : segment.text.length === 0;
        if (empty) segments.splice(index, 1);
    }
    for (let index = segments.length - 1; index > 0; index -= 1) {
        const previous = segments[index - 1];
        const current = segments[index];
        if (previous.kind === 'inserted' && current.kind === 'inserted') {
            previous.text += current.text;
            segments.splice(index, 1);
        } else if (previous.kind === 'original' && current.kind === 'original' && previous.to === current.from) {
            previous.to = current.to;
            segments.splice(index, 1);
        }
    }
}

/**
 * 本文変更を元の座標と順序に従って適用し、競合する範囲を拒否する。
 * @param value - 変更範囲を適用する基準本文。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @returns すべての変更を適用した本文。
 * @throws {RangeError} 変更範囲が本文に対して不正な場合。
 */
export function applyTextChanges(value: string, changes: readonly TextChange[]): string {
    // 変更範囲を検証して後方位置から適用し、前方のオフセットをずらさない。
    validateTextChanges(changes, value.length);
    let result = value;
    for (const change of [...changes].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => right.rangeOffset - left.rangeOffset)) {
        result = result.slice(0, change.rangeOffset)
            + change.text
            + result.slice(change.rangeOffset + change.rangeLength);
    }
    return result;
}

/**
  * 一方の変更範囲をもう一方の変更適用後へ移し、重なりや不正範囲は例外にする。
 * @param changes - 他方の変更後へ位置を写像する変更範囲。
 * @param over - 同じ基準本文に対して計算した、位置写像に使う他方の変更範囲。
 * @param baseLength - 両方の変更範囲を計算した基準本文のUTF-16文字数。
 * @param before - 同じ位置にある他方の挿入より前へ配置する場合はtrue。
  * @returns 他方の変更適用後に対応する変更範囲一覧。
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
    if (!over.length) return changes.map(
        /**
         * changesの各要素を変換して一覧化する。
         * @param change - 本文上の1件の変更範囲。

         */
        (change) => ({ ...change }));
    validateTextChanges(changes, baseLength);
    validateTextChanges(over, baseLength);
    const remote = [...over].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.rangeOffset - right.rangeOffset);
    return [...changes]
        .sort(
            /**
             * 2つの値を比較して並び順を決める。
             * @param left - 比較対象の左側の値。
             * @param right - 比較対象の右側の値。
             * @returns 2つの要素の順序を示す数値。
             */
            (left, right) => left.rangeOffset - right.rangeOffset)
        .map(
            /**
              * 入力変更を走査し、変更範囲と合成本文上の開始位置を記録する。
             */
            (change) => {
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
  * 指定オフセットを変更範囲に沿って写像し、挿入境界の所属側も反映する。
 * @param offset - 変更前本文内で対応位置を求めるUTF-16オフセット。
 * @param changes - オフセットを変更後本文へ移す変更範囲。
 * @param baseLength - 変更範囲を計算した元本文のUTF-16文字数。
 * @param association - 変更境界上の位置を前側へ寄せる場合は-1、後側へ寄せる場合は1。
  * @returns 変更後本文内のUTF-16オフセット。
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
    for (const change of [...changes].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.rangeOffset - right.rangeOffset)) {
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
 * textchangesの入力と不変条件を検証し、違反時に失敗を通知する。
 * @param changes - 本文へ適用する変更範囲の一覧。
 * @param baseLength - 変更範囲を制限する基準本文のUTF-16長。
 * @throws {RangeError} 位置・長さ・本文境界・重複のいずれかが不正な場合。
 */
export function validateTextChanges(changes: readonly TextChange[], baseLength: number): void {
    // 変更の位置・長さ・基準本文からのはみ出し・相互の重なりを検証する。
    let previousEnd = 0;
    for (const [index, change] of [...changes].sort(
        /**
         * 2つの値を比較して並び順を決める。
         * @param left - 比較対象の左側の値。
         * @param right - 比較対象の右側の値。
         * @returns 2つの要素の順序を示す数値。
         */
        (left, right) => left.rangeOffset - right.rangeOffset).entries()) {
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
