/**
 * @fileoverview ファイル・フォルダーの移動や名前変更に合わせて、ワークスペース内の Markdown 文書のリンクを書き換える。
 * 実行境界は Extension Host。VS Code 上の操作（エクスプローラーでの移動・名前変更など）で発生する onDidRenameFiles だけを対象にする。
 * 書き換えは1つの WorkspaceEdit をリファクタリングとして適用する。保存の有無は VS Code の files.refactoring.autoSave に従い、
 * 元に戻すで取り消せる。
 * 設定 markdownEasyVisualEditor.links.updateOnFileMove（prompt / always / never）に従い、
 * VS Code 標準の markdown.updateLinksOnFileMove.enabled が有効な場合は二重編集を避けるため何もしない。
 * 確認通知に応答するまでの間に次の移動が起きた場合は、その移動も保留中の一覧へ加え、応答時にまとめて計算する
 * （本文のリンクは最初の移動より前の位置が基準のため、移動を合成しないと相対パスを誤る）。
 * リンク先の文字列以外（改行コード、タイトル、本文）は変更しない。
 */
import { errorMessage } from '../shared/errorMessage';
import * as vscode from 'vscode';
import path from 'node:path';
import { composeRenameMappings, rewriteLinkDestination } from '../shared/linkPaths';
import { collectLocalLinkDestinations, encodeMarkdownPathSegment } from '../shared/markdown';
import type { Messages } from '../shared/messages';
import { isExcludedWorkspacePath, pathIgnoreCase, readWorkspaceText } from './workspaceFiles';

/** 書き換え対象を探す Markdown 文書数の上限。巨大なワークスペースで処理が長引かないようにする。 */
const MAX_SCANNED_DOCUMENTS = 20_000;

/** 設定値として受け付ける動作。未知の値は prompt として扱う。 */
export type LinkUpdateMode = 'prompt' | 'always' | 'never';

/** 移動1件を、比較用の絶対パスで表したもの。 */
export interface PathRename {
    /** 移動前の Uri.path。 */
    oldPath: string;
    /** 移動後の Uri.path。 */
    newPath: string;
}

/** 1回の移動（同じ scheme・authority に属する複数ファイルを含み得る）。 */
interface RenameBatch {
    /** 移動後の URI の1つ。検索範囲の scheme・authority と大文字小文字の扱いを決める。 */
    sampleUri: vscode.Uri;
    /** 移動前後のパスの組。 */
    renames: PathRename[];
}

/** 書き換え計算の結果。 */
export interface LinkUpdatePlan {
    /** 適用する編集。 */
    edit: vscode.WorkspaceEdit;
    /** 書き換えるリンクを含む文書の数。 */
    documentCount: number;
    /** 書き換えるリンクの数。 */
    linkCount: number;
}

/**
 * 設定値を正規化する。
 * @param value - markdownEasyVisualEditor.links.updateOnFileMove の値。
 * @returns prompt / always / never のいずれか。未設定・未知の値は prompt。
 */
export function normalizeLinkUpdateMode(value: unknown): LinkUpdateMode {
    return value === 'always' || value === 'never' ? value : 'prompt';
}

/**
 * ファイル移動を監視してリンクを書き換えるサービス。拡張機能の有効期間中に1つ作る。
 */
export class MarkdownLinkUpdater implements vscode.Disposable {
    /** onDidRenameFiles の購読。 */
    private readonly subscription: vscode.Disposable;

    /** まだ処理していない移動（発生順）。確認通知の表示中に起きた移動もここへ加わる。 */
    private pending: RenameBatch[] = [];

    /** 確認通知を表示中ならtrue。その間の移動は新しい処理を始めず、保留中の一覧へ加えるだけにする。 */
    private prompting = false;

    /** 処理を順番に行うための直列化キュー。前の処理の失敗は後続へ影響させない。 */
    private queue: Promise<void> = Promise.resolve();

    /**
     * @param getMessages - 現在の表示言語の文言を返す関数。通知の表示時に毎回呼ぶ。
     */
    constructor(private readonly getMessages: () => Messages) {
        this.subscription = vscode.workspace.onDidRenameFiles(
            /**
             * 移動を保留中の一覧へ加え、確認中でなければ処理を予約する。
             * @param event - 移動前後の URI の組。
             */
            (event) => {
                const files = event.files.filter(
                    /**
                     * scheme・authority をまたぐ移動は対象外にする。
                     * @param file - 移動前後の URI。
                     * @returns 対象にするならtrue。
                     */
                    (file) => file.oldUri.scheme === file.newUri.scheme && file.oldUri.authority === file.newUri.authority);
                if (!files.length) return;
                this.pending.push({
                    sampleUri: files[0].newUri,
                    renames: files.map(
                        /**
                         * 比較用のパスへ変換する。
                         * @param file - 移動前後の URI。
                         * @returns 移動前後のパス。
                         */
                        (file) => ({ oldPath: file.oldUri.path, newPath: file.newUri.path }))
                });
                if (this.prompting) return;
                this.queue = this.queue
                    .then(/** 保留中の移動を処理する。 */ () => this.processPending())
                    .catch(
                    /**
                     * 予期しない失敗を通知し、後続の処理を続けられるようにする。
                     * @param error - 発生した例外。
                     */
                    (error: unknown) => {
                        const detail = errorMessage(error);
                        void vscode.window.showErrorMessage(this.getMessages().host.linkUpdateFailed(detail));
                    });
            });
    }

    /**
     * 購読を解除する。処理中の書き換えは中断しない。
     */
    dispose(): void {
        this.subscription.dispose();
    }

    /**
     * それまでに予約した処理（確認通知への応答を含む）がすべて終わるまで待つ。
     * @returns 処理キューが空になった時点で解決する。失敗した処理があっても拒否しない。
     */
    whenIdle(): Promise<void> {
        return this.queue;
    }

    /**
     * 保留中の移動のうち、先頭と同じ scheme・authority のものについて、設定に従って確認し、リンクを書き換える。
     * 別の scheme・authority の移動は保留中の一覧に残し、続けて別の処理として予約する。
     * @returns 処理完了で解決する。
     */
    private async processPending(): Promise<void> {
        if (!this.pending.length) return;
        const groupKey = batchKey(this.pending[0]);
        try {
            const mode = normalizeLinkUpdateMode(
                vscode.workspace.getConfiguration('markdownEasyVisualEditor').get('links.updateOnFileMove'));
            // VS Code 標準の Markdown 拡張機能が同じ移動を処理する設定なら、二重に編集しない。
            const builtIn = vscode.workspace.getConfiguration('markdown').get<string>('updateLinksOnFileMove.enabled', 'never');
            if (mode === 'never' || builtIn !== 'never') {
                this.pending = [];
                return;
            }
            if (mode === 'always') {
                await applyPlan(await this.planGroup(this.takeGroup(groupKey), groupKey));
                return;
            }
            const checked = this.pending.filter(/** 先頭と同じ scheme・authority の移動か。 */ (batch) => batchKey(batch) === groupKey);
            const plan = await planLinkUpdates(checked);
            if (!plan.documentCount) {
                this.pending = this.pending.filter(/** 確認した移動以外を残す。 */ (batch) => !checked.includes(batch));
                return;
            }
            const messages = this.getMessages().host;
            this.prompting = true;
            let choice: string | undefined;
            try {
                // 件数は確認を出した時点の目安。応答までに起きた移動も適用時に含める。
                choice = await vscode.window.showInformationMessage(
                    messages.linkUpdatePrompt(plan.documentCount),
                    messages.linkUpdateApply,
                    messages.linkUpdateAlways,
                    messages.linkUpdateNever
                );
            } finally {
                this.prompting = false;
            }
            const batches = this.takeGroup(groupKey);
            if (choice === messages.linkUpdateNever) {
                this.pending = [];
                await updateMode('never');
                return;
            }
            if (choice === messages.linkUpdateAlways) await updateMode('always');
            else if (choice !== messages.linkUpdateApply) return;
            await applyPlan(await this.planGroup(batches, groupKey));
        } finally {
            // 別の scheme・authority の移動、または確認中に予約されなかった移動が残っていれば続けて処理する。
            if (this.pending.length) {
                this.queue = this.queue.then(/** 残りの移動を処理する。 */ () => this.processPending());
            }
        }
    }

    /**
     * 保留中の一覧から、指定した scheme・authority の移動を取り出す。
     * @param key - batchKey で作ったキー。
     * @returns 取り出した移動（発生順）。
     */
    private takeGroup(key: string): RenameBatch[] {
        const taken = this.pending.filter(/** 指定キーの移動か。 */ (batch) => batchKey(batch) === key);
        this.pending = this.pending.filter(/** 指定キー以外の移動か。 */ (batch) => batchKey(batch) !== key);
        return taken;
    }

    /**
     * 書き換えを計算する。計算中に同じ scheme・authority の移動が届いた場合は、それも合成して計算し直す
     * （本文のリンクは最初の移動より前の位置が基準のため、後から届いた移動を別に処理すると相対パスを誤る）。
     * @param batches - 計算する移動（発生順）。
     * @param key - batchKey で作ったキー。
     * @returns 適用する編集と件数。
     */
    private async planGroup(batches: RenameBatch[], key: string): Promise<LinkUpdatePlan> {
        let current = batches;
        for (;;) {
            const plan = await planLinkUpdates(current);
            const arrived = this.takeGroup(key);
            if (!arrived.length) return plan;
            current = [...current, ...arrived];
        }
    }
}

/**
 * 移動を scheme・authority ごとにまとめるためのキーを作る。
 * @param batch - 1回分の移動。
 * @returns scheme と authority を連結したキー。
 */
function batchKey(batch: RenameBatch): string {
    return `${batch.sampleUri.scheme}://${batch.sampleUri.authority}`;
}

/**
 * 計算した編集をリファクタリングとして適用する。書き換える文書がなければ何もしない。
 * @param plan - 適用する編集と件数。
 * @returns 適用完了で解決する。
 */
async function applyPlan(plan: LinkUpdatePlan): Promise<void> {
    if (plan.documentCount) await vscode.workspace.applyEdit(plan.edit, { isRefactoring: true });
}

/**
 * 設定をユーザー設定へ保存する。
 * @param mode - 保存する動作。
 * @returns 保存完了で解決する。
 */
async function updateMode(mode: LinkUpdateMode): Promise<void> {
    await vscode.workspace.getConfiguration('markdownEasyVisualEditor')
        .update('links.updateOnFileMove', mode, vscode.ConfigurationTarget.Global);
}

/**
 * 発生順の移動に伴って書き換えるリンクを、ワークスペース内の Markdown 文書から集める。
 * 移動した文書自身は、移動していないリンク先への相対パスも新しい位置から計算し直す。
 * 最初の移動の scheme・authority に属する文書だけを対象にする。
 * @param batches - 発生順の移動。空なら何もしない。
 * @returns 適用する編集と件数。
 */
export async function planLinkUpdates(batches: ReadonlyArray<RenameBatch>): Promise<LinkUpdatePlan> {
    const edit = new vscode.WorkspaceEdit();
    let documentCount = 0;
    let linkCount = 0;
    const sampleUri = batches[0]?.sampleUri;
    if (!sampleUri) return { edit, documentCount, linkCount };
    const ignoreCase = pathIgnoreCase(sampleUri);
    const mapping = composeRenameMappings(batches.map(
        /**
         * 1回分の移動の組を取り出す。
         * @param batch - 1回分の移動。
         * @returns 移動前後の組。
         */
        (batch) => batch.renames), ignoreCase);
    const needles = renameNeedles(batches.flatMap(
        /**
         * 1回分の移動の組を取り出す。
         * @param batch - 1回分の移動。
         * @returns 移動前後の組。
         */
        (batch) => batch.renames), ignoreCase);
    const documents = await vscode.workspace.findFiles('**/*.{md,markdown}', undefined, MAX_SCANNED_DOCUMENTS);
    for (const uri of documents) {
        if (uri.scheme !== sampleUri.scheme || uri.authority !== sampleUri.authority) continue;
        if (isExcludedWorkspacePath(uri.path)) continue;
        const oldDocumentPath = mapping.toOld(uri.path) ?? uri.path;
        const documentMoved = oldDocumentPath !== uri.path;
        const preview = await readWorkspaceText(uri);
        if (preview === undefined) continue;
        // 移動していない文書は、移動元の名前を含まなければリンクの解析を省く。
        const haystack = ignoreCase ? preview.toLowerCase() : preview;
        if (!documentMoved && !needles.some(
            /**
             * 移動元の名前の表記が本文に含まれるか調べる。
             * @param needle - 名前の表記（大文字小文字を区別しない場合は小文字化済み）。
             * @returns 含まれればtrue。
             */
            (needle) => haystack.includes(needle))) continue;
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        const workspaceRootPath = vscode.workspace.getWorkspaceFolder(uri)?.uri.path;
        let changed = 0;
        for (const link of collectLocalLinkDestinations(text)) {
            const next = rewriteLinkDestination(link, {
                documentOldPath: oldDocumentPath,
                documentNewPath: uri.path,
                workspaceRootPath,
                ignoreCase
            }, mapping.toNew);
            if (next === undefined) continue;
            edit.replace(uri, new vscode.Range(document.positionAt(link.start), document.positionAt(link.end)), next);
            changed += 1;
        }
        if (changed) {
            documentCount += 1;
            linkCount += changed;
        }
    }
    return { edit, documentCount, linkCount };
}

/**
 * 移動元の名前が本文に現れ得る表記を列挙する。
 * そのまま・Markdown用エンコード・URIエンコード（大文字・小文字の16進）と、NFC・NFD の両方の正規化形を含める。
 * @param renames - 移動前後の絶対パスの組。
 * @param ignoreCase - 大文字小文字を区別しない場合はtrue。照合用に小文字へそろえる。
 * @returns 本文の事前絞り込みに使う文字列の一覧。
 */
function renameNeedles(renames: readonly PathRename[], ignoreCase: boolean): string[] {
    const needles = new Set<string>();
    for (const rename of renames) {
        const baseName = path.posix.basename(rename.oldPath);
        for (const name of new Set([baseName.normalize('NFC'), baseName.normalize('NFD')])) {
            if (!name) continue;
            const uriEncoded = encodeURIComponent(name);
            needles.add(name);
            needles.add(encodeMarkdownPathSegment(name));
            needles.add(uriEncoded);
            needles.add(uriEncoded.replace(/%[0-9A-F]{2}/gu, (escape) => escape.toLowerCase()));
        }
    }
    return [...needles].map(
        /**
         * 大文字小文字を区別しない場合は、照合用に小文字へそろえる。
         * @param needle - 名前の表記。
         * @returns 照合用の表記。
         */
        (needle) => ignoreCase ? needle.toLowerCase() : needle);
}
