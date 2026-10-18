/**
 * @fileoverview 描画済みMermaidの全体を、プレビュー倍率に依存しないPNGへ変換する。
 */
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 16 * 1024 * 1024;

/**
 * SVG表示または画像化表示のMermaidから、クリップボードへ書き込むPNGを準備する。
 * @param diagram - コピー対象の描画済みMermaidブロック。
 * @param signal - メニューが閉じた場合に準備を中止する通知。
 * @returns 図全体を含むimage/pngのBlob。
 */
export async function prepareMermaidClipboardPng(diagram: HTMLElement, signal?: AbortSignal): Promise<Blob> {
    signal?.throwIfAborted();
    if (diagram.dataset.mermaidStatus !== 'ready') throw new Error('Mermaid is not ready.');
    const svg = diagram.querySelector<SVGSVGElement>(':scope > svg');
    if (svg) return svgToPng(svg, diagram, signal);

    const image = diagram.querySelector<HTMLImageElement>(':scope > .mermaid-svg-frame > .mermaid-svg-image');
    const source = image?.currentSrc || image?.src;
    if (!source) throw new Error('Mermaid image is unavailable.');
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error('Mermaid image could not be read.');
    const blob = await response.blob();
    signal?.throwIfAborted();
    if (!blob.size) throw new Error('Mermaid image is empty.');
    if (blob.type.split(';', 1)[0] === 'image/png') return boundedPng(blob, signal);
    if (blob.type.split(';', 1)[0] !== 'image/svg+xml') throw new Error('Mermaid image format is unsupported.');
    const document = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    const imageSvg = document.querySelector<SVGSVGElement>('svg');
    if (!imageSvg || document.querySelector('parsererror')) throw new Error('Mermaid SVG is invalid.');
    return svgToPng(imageSvg, diagram, signal);
}

/**
 * SVGの座標系全体をCanvasへ描画し、巨大図では縦横比を保って画素数を制限する。
 * @param svg - 元の図の寸法と描画内容を持つSVG。
 * @param diagram - PNGへ引き継ぐ背景色を取得する表示ブロック。
 * @param signal - PNGの生成前に準備を中止する通知。
 * @returns PNGへの変換結果。
 */
async function svgToPng(svg: SVGSVGElement, diagram: HTMLElement, signal?: AbortSignal): Promise<Blob> {
    const originalWidth = svg.viewBox.baseVal.width || svg.width.baseVal.value;
    const originalHeight = svg.viewBox.baseVal.height || svg.height.baseVal.value;
    if (!Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) || originalWidth <= 0 || originalHeight <= 0) {
        throw new Error('Mermaid dimensions are invalid.');
    }
    const { width, height } = rasterSize(originalWidth, originalHeight);
    const snapshot = svg.cloneNode(true) as SVGSVGElement;
    snapshot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    snapshot.setAttribute('width', String(width));
    snapshot.setAttribute('height', String(height));
    snapshot.style.width = `${width}px`;
    snapshot.style.height = `${height}px`;
    snapshot.style.maxWidth = 'none';
    snapshot.style.removeProperty('--mve-mermaid-width');
    if (svg.isConnected) {
        const style = getComputedStyle(svg);
        snapshot.style.fontFamily = style.fontFamily;
        snapshot.style.color = style.color;
    }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(snapshot)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        signal?.throwIfAborted();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG canvas is unavailable.');
        // 透明領域にも現在の背景を引き継ぎ、暗色テーマの文字を貼り付け先で読めるようにする。
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        const backgrounds: string[] = [];
        for (let ancestor: Element | null = diagram; ancestor; ancestor = ancestor.parentElement) {
            backgrounds.push(getComputedStyle(ancestor).backgroundColor);
        }
        for (const color of backgrounds.reverse()) {
            context.fillStyle = color;
            context.fillRect(0, 0, width, height);
        }
        context.drawImage(image, 0, 0, width, height);
        return await encodeCanvas(canvas, signal);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** 元の縦横比を保ち、PNGの寸法と画素数を上限内へ収める。 */
function rasterSize(width: number, height: number): { width: number; height: number } {
    const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height, Math.sqrt(MAX_PIXELS / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/**
 * PNGヘッダーで寸法を確認し、上限内は再利用、超過時は全体を縮小する。
 * @param blob - 画像化済みMermaidのPNG。
 * @param signal - メニュー終了時の中止通知。
 * @returns 上限内のPNG。
 */
async function boundedPng(blob: Blob, signal?: AbortSignal): Promise<Blob> {
    const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    signal?.throwIfAborted();
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (header.length < 24 || !signature.every((value, index) => header[index] === value)
        || String.fromCharCode(...header.slice(12, 16)) !== 'IHDR') throw new Error('Mermaid PNG is invalid.');
    const view = new DataView(header.buffer);
    const originalWidth = view.getUint32(16);
    const originalHeight = view.getUint32(20);
    if (!originalWidth || !originalHeight) throw new Error('Mermaid PNG dimensions are invalid.');
    const { width, height } = rasterSize(originalWidth, originalHeight);
    if (width === originalWidth && height === originalHeight) return blob;
    const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    try {
        signal?.throwIfAborted();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PNG canvas is unavailable.');
        context.drawImage(bitmap, 0, 0);
        return await encodeCanvas(canvas, signal);
    } finally {
        bitmap.close();
    }
}

/**
 * PNGエンコード後も中止を確認し、Canvasの画素バッファを解放する。
 * @param canvas - PNGへエンコードするCanvas。
 * @param signal - エンコード中に届いた場合は結果を破棄する中止通知。
 * @returns エンコード済みPNG。
 */
async function encodeCanvas(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
    try {
        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(value => value?.size ? resolve(value) : reject(new Error('Mermaid PNG conversion failed.')), 'image/png');
        });
        signal?.throwIfAborted();
        return blob;
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
