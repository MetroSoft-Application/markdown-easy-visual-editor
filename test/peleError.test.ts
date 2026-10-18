/**
 * @fileoverview Pele描画エラーがMermaid本文を利用者向け情報へ含めないことを検証する。
 */
import { describe, expect, it } from 'vitest';
import { sanitizePeleRenderError } from '../src/shared/peleError';

describe('Pele描画エラー', () => {
    it('固定文言を返し、ソース本文を含めない', () => {
        const source = 'flowchart LR\n  internal-secret --> B';
        const error = new Error(`Syntax error in ${source}`);
        const safeMessage = sanitizePeleRenderError(error);

        expect(safeMessage).toBe('Mermaid diagram could not be rendered.');
        expect(safeMessage).not.toContain(source);
        expect(safeMessage).not.toContain(error.message);
    });
});
