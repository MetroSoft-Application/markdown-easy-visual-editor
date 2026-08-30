import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { buildChatSelectionSnapshot, type ZeroBasedPosition } from './chatContext';

interface StoredSnapshot {
  directory: vscode.Uri;
  resource: vscode.Uri;
}

/**
 * Copilot Chatへ渡す選択範囲を一時ファイルとして保持する。
 * 選択更新時に旧ファイルを削除し、VS Code側の添付監視へ差し替えを通知する。
 */
export class CopilotSelectionSnapshotStore implements vscode.Disposable {
  private current?: StoredSnapshot;

  constructor(private readonly root: vscode.Uri) {}

  async replace(
    originalResource: vscode.Uri,
    start: ZeroBasedPosition,
    selectedText: string
  ): Promise<vscode.Uri> {
    const basename = path.posix.basename(originalResource.path) || 'selection.md';
    const directory = vscode.Uri.joinPath(this.root, randomUUID());
    const resource = vscode.Uri.joinPath(directory, basename);
    const content = buildChatSelectionSnapshot(start, selectedText);

    await vscode.workspace.fs.createDirectory(directory);
    await vscode.workspace.fs.writeFile(resource, Buffer.from(content, 'utf8'));

    const previous = this.current;
    this.current = { directory, resource };
    if (previous) {
      await Promise.resolve(
        vscode.workspace.fs.delete(previous.directory, { recursive: true, useTrash: false })
      ).catch(() => undefined);
    }
    return resource;
  }

  dispose(): void {
    const current = this.current;
    this.current = undefined;
    if (current) {
      void Promise.resolve(
        vscode.workspace.fs.delete(current.directory, { recursive: true, useTrash: false })
      ).catch(() => undefined);
    }
  }
}
