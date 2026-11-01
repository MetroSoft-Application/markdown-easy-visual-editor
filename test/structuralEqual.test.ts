/**
 * @fileoverview Host設定の再送で前のstateを再利用するための構造比較（structurallyEqual / reuseIfStructurallyEqual）の仕様を検証する。
 * 回帰リスク: 異なる設定を「等しい」と誤判定すると、設定変更がWebviewへ反映されなくなる。そのため誤って等しいと判定しないことを重点的に確認する。
 */
import { describe, expect, it } from 'vitest';
import { reuseIfStructurallyEqual, structurallyEqual } from '../src/webview/runtime/structuralEqual';

describe('structurallyEqual',
    () => {
        it('treats equal nested settings objects as equal regardless of identity', () => {
            const left = { theme: 'dark', pdfOptions: { pageSize: 'A4', margins: [10, 12] }, flags: [true, false] };
            const right = { flags: [true, false], pdfOptions: { margins: [10, 12], pageSize: 'A4' }, theme: 'dark' };
            expect(structurallyEqual(left, right)).toBe(true);
        });

        it('detects any value difference at any depth', () => {
            const base = { pdfOptions: { pageSize: 'A4', margins: [10, 12] } };
            expect(structurallyEqual(base, { pdfOptions: { pageSize: 'A5', margins: [10, 12] } })).toBe(false);
            expect(structurallyEqual(base, { pdfOptions: { pageSize: 'A4', margins: [10, 13] } })).toBe(false);
            expect(structurallyEqual(base, { pdfOptions: { pageSize: 'A4', margins: [10, 12, 0] } })).toBe(false);
            expect(structurallyEqual({ size: 1 }, { size: '1' })).toBe(false);
        });

        it('distinguishes a missing key from a key holding undefined', () => {
            expect(structurallyEqual({ a: undefined }, {})).toBe(false);
            expect(structurallyEqual({}, { a: undefined })).toBe(false);
        });

        it('distinguishes arrays from objects and null from objects', () => {
            expect(structurallyEqual([], {})).toBe(false);
            expect(structurallyEqual({ 0: 'a', length: 1 }, ['a'])).toBe(false);
            expect(structurallyEqual(null, {})).toBe(false);
            expect(structurallyEqual({ a: null }, { a: {} })).toBe(false);
        });

        it('uses Object.is semantics for primitives', () => {
            expect(structurallyEqual(Number.NaN, Number.NaN)).toBe(true);
            expect(structurallyEqual(0, -0)).toBe(false);
        });

        it('only treats non-plain objects as equal when they are the same instance', () => {
            const date = new Date(0);
            expect(structurallyEqual(date, date)).toBe(true);
            expect(structurallyEqual(new Date(0), new Date(0))).toBe(false);
            expect(structurallyEqual(new Map(), new Map())).toBe(false);
        });
    });

describe('reuseIfStructurallyEqual',
    () => {
        it('keeps the previous reference when the content is unchanged', () => {
            const previous = { theme: 'light', fontSize: 14 };
            expect(reuseIfStructurallyEqual(previous, { theme: 'light', fontSize: 14 })).toBe(previous);
        });

        it('adopts the next value when the content changed', () => {
            const previous = { theme: 'light', fontSize: 14 };
            const next = { theme: 'light', fontSize: 16 };
            expect(reuseIfStructurallyEqual(previous, next)).toBe(next);
        });
    });
