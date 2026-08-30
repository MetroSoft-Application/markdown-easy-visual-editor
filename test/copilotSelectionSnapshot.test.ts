import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => {
  const createDirectory = vi.fn(async (_uri: unknown) => undefined);
  const writeFile = vi.fn(async (_uri: unknown, _content: Uint8Array) => undefined);
  const deleteResource = vi.fn(async (_uri: unknown, _options: unknown) => undefined);
  return { createDirectory, writeFile, deleteResource };
});

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { scheme: string; path: string }, ...parts: string[]) => ({
      scheme: base.scheme,
      path: `${base.path.replace(/\/$/, '')}/${parts.join('/')}`,
      toString() { return `${this.scheme}:${this.path}`; }
    })
  },
  workspace: {
    fs: {
      createDirectory: vscodeMock.createDirectory,
      writeFile: vscodeMock.writeFile,
      delete: vscodeMock.deleteResource
    }
  }
}));

import { CopilotSelectionSnapshotStore } from '../src/extension/copilotSelectionSnapshot';

describe('Copilot selection snapshot replacement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes a new uniquely identified snapshot and deletes the previous attachment resource', async () => {
    const store = new CopilotSelectionSnapshotStore({ scheme: 'file', path: '/storage' } as never);
    const original = { scheme: 'file', path: '/workspace/docs/example.md' } as never;

    const first = await store.replace(original, { line: 2, character: 3 }, 'first');
    const second = await store.replace(original, { line: 4, character: 1 }, 'second');

    expect(first.path).not.toBe(second.path);
    expect(first.path.endsWith('/example.md')).toBe(true);
    expect(second.path.endsWith('/example.md')).toBe(true);
    expect(vscodeMock.deleteResource).toHaveBeenCalledTimes(1);
    expect(vscodeMock.deleteResource).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/storage/') }),
      { recursive: true, useTrash: false }
    );
    expect(Buffer.from(vscodeMock.writeFile.mock.calls[1][1]).toString('utf8')).toBe('\n\n\n\n second');

    store.dispose();
  });
});
