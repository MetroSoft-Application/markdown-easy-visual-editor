/**
 * @fileoverview ESM Webviewとその分割チャンクをChromiumテストへ配信するサーバーです。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * dist配下のWebview資産を同一originから配信するテストサーバーを起動します。
 * @returns originと終了処理を含むWebviewテストサーバーです。
 */
export async function startWebviewAssetServer() {
  const root = path.resolve('dist');
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
      return;
    }
    if (!url.pathname.startsWith('/dist/')) {
      response.writeHead(404).end('not found');
      return;
    }

    const relativePath = decodeURIComponent(url.pathname.slice('/dist/'.length));
    const filePath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, filePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      response.writeHead(403).end('forbidden');
      return;
    }

    try {
      const body = await readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const contentType = extension === '.css'
        ? 'text/css'
        : extension === '.mjs' || extension === '.js'
          ? 'text/javascript'
          : 'application/octet-stream';
      response.writeHead(200, { 'content-type': `${contentType}; charset=utf-8` });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Webviewテスト用HTTPサーバーを開始できませんでした。');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
