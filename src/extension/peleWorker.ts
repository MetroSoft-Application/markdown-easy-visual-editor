/**
 * @fileoverview Peleの同期描画を隔離ブラウザーのWorker内で実行する。
 */
import { render } from 'pele';
import type { LinkInfo, RenderOptions } from 'pele';
import { sanitizePeleRenderError } from '../shared/peleError';

interface PeleRenderRequest {
    id: string;
    source: string;
    theme: 'default' | 'dark' | 'neutral';
    fontFamily: string;
    now: number;
}

interface PeleRenderResponse {
    id: string;
    svg?: string;
    links?: LinkInfo[];
    error?: string;
}

const palettes = {
    default: {
        bg: '#ffffff', fg: '#1f1f1f', muted: '#6e6e6e', line: '#1f1f1f',
        surface: '#f3f3f3', surfaceAlt: '#e6e6e6', border: '#8a8a8a', accent: '#5b7bd5', critical: '#e45756'
    },
    dark: {
        bg: '#100f0f', fg: '#cecdc3', muted: '#878580', line: '#cecdc3',
        surface: '#1c1b1a', surfaceAlt: '#282726', border: '#403e3c', accent: '#4385be', critical: '#d14d41'
    },
    neutral: {
        bg: '#ffffff', fg: '#303030', muted: '#737373', line: '#404040',
        surface: '#f2f2f2', surfaceAlt: '#e7e7e7', border: '#8a8a8a', accent: '#5f6b7a', critical: '#565656'
    }
} as const;

const workerScope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<PeleRenderRequest>) => void) | null;
    postMessage: (message: PeleRenderResponse) => void;
};

workerScope.onmessage = (event) => {
    const request = event.data;
    try {
        const options: RenderOptions = {
            fontFamily: request.fontFamily || 'sans-serif',
            fontFamilyMono: 'monospace',
            fontSize: 16,
            idPrefix: `mve-${request.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            responsive: false,
            autoDirection: false,
            limit: 50_000,
            outputLimit: 4_000_000,
            maxEdges: 5_000,
            linkSchemes: ['http', 'https', 'file'],
            imageSchemes: ['http', 'https', 'file'],
            links: true,
            images: true,
            now: request.now
        };
        const result = render(request.source, options);
        const palette = palettes[request.theme];
        const paletteStyle = [
            ['bg', palette.bg], ['fg', palette.fg], ['muted', palette.muted], ['line', palette.line],
            ['surface', palette.surface], ['surface-alt', palette.surfaceAlt], ['border', palette.border],
            ['accent', palette.accent], ['critical', palette.critical]
        ].map(([name, value]) => `--pele-${name}:${value}`).join(';');
        const svg = result.svg.replace(/<svg\b[^>]*>/, (openingTag) => {
            if (/\bstyle\s*=\s*(["'])/.test(openingTag)) {
                return openingTag.replace(/\bstyle\s*=\s*(["'])(.*?)\1/, (_, quote: string, value: string) =>
                    `style=${quote}${value};${paletteStyle}${quote}`);
            }
            return openingTag.replace(/>$/, ` style="${paletteStyle}">`);
        });
        workerScope.postMessage({ id: request.id, svg, links: result.links });
    } catch (error) {
        workerScope.postMessage({ id: request.id, error: sanitizePeleRenderError(error) });
    }
};
