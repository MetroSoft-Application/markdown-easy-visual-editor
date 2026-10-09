/**
 * @fileoverview Git index上の対象ソースについて、ファイル概要、export function形式の引数・戻り値タグ、既知の空疎なブロックコメントを検査する。
 * CSSではファイル概要のみを調べる。他の宣言形式やコメントの意味は判定しないため、内容を目視と第三者レビューで確認する。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['src/', 'scripts/', 'test/'];
const ADDITIONAL_FILES = new Set(['vitest.config.mts']);
const SELF_CHECKED_FILES = ['scripts/check-documentation-comments.mjs'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.css']);
const HASH_BYTES = 20;
const SPLIT_IDENTIFIER = /(?<![A-Za-z0-9])(?:[a-z][A-Za-z0-9]*・[A-Z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*・[a-z][A-Za-z0-9]*)/u;
const GENERATED_PHRASES = [
  /呼び出し側へ結果または副作用を返す/u,
  /(?:コールバック|関数)が生成する結果/u,
  /コールバックとして/u,
  /@param _ - 引数位置を維持するための未使用値/u,
  /@param index - 配列・行列・文字列の要素位置を示す番号/u,
  /DOMまたは状態を保持する参照/u,
  /@returns [^\n]*非同期処理で得られる結果/u,
  /@returns [^\n]*に対応する要素の一覧/u,
  /@returns (?:条件を満たした要素だけを含む一覧|入力要素から生成した変換結果の一覧)/u,
  /@returns [^\n]*で利用する(?:文字列|数値)/u,
  /@returns [^\n]*で生成または変換した値/u,
  /入力を構造化した値へ変換する/u,
  /入力を許可された形式へ整える/u,
  /使う値または実行環境を組み立てる/u,
  /表示用の結果へ変換する/u,
  /変更または要求をHost・Webview間へ通知する/u,
  /対象や分岐を識別する値の型/u,
  /共有するデータ形状を表すインターフェース/u,
  /位置・寸法・件数・時間を表す数値/u,
  /回帰の対象や分岐を識別する値/u,
  /@returns (?:非同期処理の完了値|表示文言・テストの回帰で利用する文字列)/u,
  /必要な値またはリソースを取得する/u,
  /状態または設定/u,
  /結果または副作用を処理する/u,
  /値は返さない/u,
];

function readTrackedPaths(index) {
  if (index.toString('ascii', 0, 4) !== 'DIRC') throw new Error('Git index header is invalid.');
  const version = index.readUInt32BE(4);
  if (version !== 2 && version !== 3) throw new Error(`Unsupported Git index version: ${version}`);

  const count = index.readUInt32BE(8);
  const paths = [];
  let offset = 12;
  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entryStart = offset;
    const flagsOffset = entryStart + 40 + HASH_BYTES;
    if (flagsOffset + 2 > index.length) throw new Error('Git index entry is truncated.');
    const flags = index.readUInt16BE(flagsOffset);
    let pathStart = flagsOffset + 2 + ((flags & 0x4000) ? 2 : 0);
    const nul = index.indexOf(0, pathStart);
    if (nul < 0) throw new Error('Git index path is not terminated.');
    paths.push(index.toString('utf8', pathStart, nul));
    offset = nul + 1;
    while ((offset - entryStart) % 8 !== 0) offset += 1;
  }
  return paths;
}

function getSourceFiles(trackedPaths) {
  const tracked = trackedPaths.filter((file) => {
    const inScope = ROOTS.some((root) => file.startsWith(root)) || ADDITIONAL_FILES.has(file);
    return inScope && SOURCE_EXTENSIONS.has(path.posix.extname(file));
  });
  return [...new Set([...tracked, ...SELF_CHECKED_FILES])].sort();
}

function getLeadingJsDoc(source, position) {
  const preceding = source.slice(0, position).trimEnd();
  if (!preceding.endsWith('*/')) return undefined;
  const close = preceding.length - 2;
  const start = preceding.lastIndexOf('/*', close);
  if (start < 0) return undefined;
  const comment = preceding.slice(start, close + 2);
  if (!comment.startsWith('/**') || /@fileoverview\b/u.test(comment)) return undefined;
  return comment;
}

function hasFileOverview(source) {
  return /^\s*\/\*\*[\s\S]*?@fileoverview\b[\s\S]*?\*\//u.test(source);
}

function getJsDocTags(doc) {
  const tags = new Map();
  for (const match of doc.matchAll(/@(param|returns?)\s+(?:\{[^}]+\}\s*)?([^\s-]+)?/gu)) {
    const key = match[1].startsWith('return') ? 'returns' : 'param';
    const name = key === 'param' ? match[2]?.replace(/^[|]$/gu, '').split('=')[0] : undefined;
    if (!tags.has(key)) tags.set(key, []);
    tags.get(key).push(name);
  }
  return tags;
}

function findClosingDelimiter(source, start) {
  const pairs = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const stack = [pairs.get(source[start])];
  let quote;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      if (index < 0) return -1;
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) return -1;
      continue;
    }
    if (pairs.has(char)) stack.push(pairs.get(char));
    else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function splitParameters(parameters) {
  const items = [];
  let start = 0;
  for (let index = 0; index < parameters.length; index += 1) {
    if ('([{'.includes(parameters[index])) {
      const close = findClosingDelimiter(parameters, index);
      if (close >= 0) index = close;
    } else if (parameters[index] === ',') {
      items.push(parameters.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = parameters.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function parseFunctionParameters(source, openParen) {
  const closeParen = findClosingDelimiter(source, openParen);
  if (closeParen < 0) return undefined;
  const parameters = splitParameters(source.slice(openParen + 1, closeParen));
  const names = parameters.flatMap((parameter) => {
    if (parameter.startsWith('{')) {
      const closeBrace = findClosingDelimiter(parameter, 0);
      if (closeBrace < 0) return [];
      return splitParameters(parameter.slice(1, closeBrace)).map((property) => property.match(/^([A-Za-z_$][\w$]*)/u)?.[1]).filter(Boolean);
    }
    return [parameter.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*[?!]?(?=\s*[:,=])/u)?.[1]].filter(Boolean);
  });
  let cursor = closeParen + 1;
  while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
  let returnType;
  if (source[cursor] === ':') {
    cursor += 1;
    const typeStart = cursor;
    let angleDepth = 0;
    let nestedDepth = 0;
    let objectDepth = 0;
    let quote;
    while (cursor < source.length) {
      const char = source[cursor];
      if (quote) {
        if (char === '\\') cursor += 1;
        else if (char === quote) quote = undefined;
        cursor += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        cursor += 1;
        continue;
      }
      if (char === '/' && source[cursor + 1] === '*') {
        const close = source.indexOf('*/', cursor + 2);
        if (close < 0) break;
        cursor = close + 2;
        continue;
      }
      if (char === '/' && source[cursor + 1] === '/') {
        const newline = source.indexOf('\n', cursor + 2);
        if (newline < 0) break;
        cursor = newline + 1;
        continue;
      }
      if (char === '{' && angleDepth === 0 && nestedDepth === 0 && objectDepth === 0) {
        const currentType = source.slice(typeStart, cursor).trimEnd();
        if (currentType && !/(?:[|&?:,(]|=>)$/u.test(currentType)) break;
        objectDepth += 1;
      } else if (char === '{') objectDepth += 1;
      else if (char === '}' && objectDepth > 0) objectDepth -= 1;
      else if (char === '<') angleDepth += 1;
      else if (char === '>' && angleDepth > 0) angleDepth -= 1;
      else if ('(['.includes(char)) nestedDepth += 1;
      else if (') ]'.replace(' ', '').includes(char) && nestedDepth > 0) nestedDepth -= 1;
      cursor += 1;
    }
    returnType = source.slice(typeStart, cursor).trim().replace(/;$/u, '');
  }
  return { closeParen, names, returnType };
}

function inspectTypeScriptFile(relativePath, source) {
  const diagnostics = [];
  const exportedDeclaration = /^export\s+(?:(?:declare|default|abstract|async)\s+)*(?:function|class|interface|type|enum|const|let|var)\b/gmu;
  for (const match of source.matchAll(exportedDeclaration)) {
    if (!getLeadingJsDoc(source, match.index)) {
      const line = source.slice(0, match.index).split(/\r?\n/u).length;
      diagnostics.push(`${relativePath}:${line} 公開宣言にJSDocがありません。`);
    }
  }

  const exportedFunction = /\bexport\s+(?:(?:declare|default|async)\s+)*function\s+[$\w]+\s*\(/gmu;
  for (const match of source.matchAll(exportedFunction)) {
    const openParen = source.indexOf('(', match.index + match[0].lastIndexOf('function'));
    const signature = parseFunctionParameters(source, openParen);
    if (!signature) continue;
    const returnType = signature.returnType;
    const doc = getLeadingJsDoc(source, match.index);
    if (!doc) continue;
    const tags = getJsDocTags(doc);
    const expected = signature.names;
    const documented = tags.get('param') ?? [];
    for (const name of expected) {
      if (!documented.includes(name)) {
        const line = source.slice(0, match.index).split(/\r?\n/u).length;
        diagnostics.push(`${relativePath}:${line} @param ${name} の説明がありません。`);
      }
    }
    for (const name of documented) {
      if (name && !expected.includes(name)) {
        const line = source.slice(0, match.index).split(/\r?\n/u).length;
        diagnostics.push(`${relativePath}:${line} @param ${name} は宣言引数にありません。`);
      }
    }
    const hasReturnsTag = (tags.get('returns') ?? []).length > 0;
    const hasKnownReturnType = Boolean(returnType);
    const returnsVoid = ['void', 'Promise<void>'].includes(returnType?.replace(/\s+/gu, ''));
    if (hasKnownReturnType && !returnsVoid && !hasReturnsTag) {
      const line = source.slice(0, match.index).split(/\r?\n/u).length;
      diagnostics.push(`${relativePath}:${line} 戻り値のある公開関数に @returns がありません。`);
    }
    if (returnsVoid && hasReturnsTag) {
      const line = source.slice(0, match.index).split(/\r?\n/u).length;
      diagnostics.push(`${relativePath}:${line} void関数に不要な @returns があります。`);
    }
  }

  const comments = [...source.matchAll(/\/\*[\s\S]*?\*\//gu)];
  for (const comment of comments) {
    const text = comment[0];
    const line = source.slice(0, comment.index).split(/\r?\n/u).length;
    const splitIdentifier = text.match(SPLIT_IDENTIFIER)?.[0];
    if (splitIdentifier) diagnostics.push(`${relativePath}:${line} 識別子を中黒で分割したコメントがあります（${splitIdentifier}）。`);
    const generatedPhrase = GENERATED_PHRASES.find((pattern) => pattern.test(text));
    if (generatedPhrase) diagnostics.push(`${relativePath}:${line} 意味の薄い定型コメントがあります（${text.match(generatedPhrase)?.[0]}）。`);
  }
  return diagnostics;
}

async function inspectFile(projectRoot, relativePath) {
  const source = await readFile(path.join(projectRoot, relativePath), 'utf8');
  const diagnostics = [];
  if (relativePath.endsWith('.css')) {
    if (!hasFileOverview(source)) diagnostics.push(`${relativePath}:1 ファイル概要のJSDocがありません。`);
  } else {
    if (!hasFileOverview(source)) diagnostics.push(`${relativePath}:1 ファイル概要のJSDocがありません。`);
    diagnostics.push(...inspectTypeScriptFile(relativePath, source));
  }
  return diagnostics;
}

async function main() {
  const projectRoot = process.cwd();
  const index = await readFile(path.join(projectRoot, '.git', 'index'));
  const files = getSourceFiles(readTrackedPaths(index));
  const diagnostics = (await Promise.all(files.map((file) => inspectFile(projectRoot, file)))).flat();
  if (diagnostics.length > 0) {
    process.stderr.write(`${diagnostics.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`限定された機械検査に合格しました（${files.length}ファイル）。コメントの意味監査と第三者レビューは別途必要です。\n`);
}

await main();
