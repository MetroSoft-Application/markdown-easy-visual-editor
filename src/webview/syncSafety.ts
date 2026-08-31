import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { applyTextChanges } from '../shared/textChanges';

type LocalChangesMessage = Extract<WebviewToHostMessage, { type: 'localChanges' }>;
type ResyncRequestMessage = Extract<WebviewToHostMessage, { type: 'requestResync' }>;
type ResyncMessage = Extract<HostToWebviewMessage, { type: 'resyncRequired' }>;

interface KnownOperation {
  clientId: string;
  opId: string;
  baseVersion: number;
  baseText?: string;
  resultText?: string;
  settled: boolean;
  settledVersion?: number;
}

export type SyncSafetyOutboundDecision =
  | { kind: 'forward' }
  | { kind: 'block'; reason: string; recovery: ResyncRequestMessage };

export type SyncSafetyInboundDecision =
  | { kind: 'forward'; message: HostToWebviewMessage }
  | { kind: 'drop'; reason: string };

export interface SyncSafetySnapshot {
  intentSerial: number;
  lastWriteIntentSerial: number;
  hostVersion?: number;
  hostTextKnown: boolean;
  resyncStreak: number;
  automaticReplayBudget: number;
  automaticWritesBlocked: boolean;
  blockedWriteStreak: number;
  pendingOperationIds: string[];
}

/**
 * WebviewとExtension Host間の編集同期へ、再送回数と因果関係の上限を強制する。
 *
 * 不変条件:
 * - 新しいユーザー編集意図なしにlocalChangesを無制限には送れない。
 * - 再同期からの自動再送は「未適用」が本文とversionで証明できた場合の1回だけ。
 * - 証明不能、2回目の再同期、原因不明の自動書き込みはfail-closedで停止する。
 */
export class SyncSafetyGuard {
  private clientId?: string;
  private hostText?: string;
  private hostVersion?: number;
  private intentSerial = 0;
  private lastWriteIntentSerial = 0;
  private resyncStreak = 0;
  private lastResyncIntentSerial = -1;
  private automaticReplayBudget = 0;
  private automaticWritesBlocked = false;
  private blockedWriteStreak = 0;
  private readonly operations = new Map<string, KnownOperation>();

  /** 信頼できるユーザー操作が新しい文書変更を発生させ得ることを記録する。 */
  noteMutationIntent(_reason = 'user'): void {
    this.intentSerial += 1;
    this.resyncStreak = 0;
    this.lastResyncIntentSerial = -1;
    this.automaticReplayBudget = 0;
    this.automaticWritesBlocked = false;
    this.blockedWriteStreak = 0;
  }

  /** WebviewからHostへ送るメッセージを検査し、無因果な書き込みを遮断する。 */
  handleOutbound(message: WebviewToHostMessage): SyncSafetyOutboundDecision {
    if (message.type === 'ready') {
      this.clientId = message.clientId;
      return { kind: 'forward' };
    }
    if (message.type === 'requestResync') return { kind: 'forward' };
    if (message.type !== 'localChanges') return { kind: 'forward' };

    if (this.clientId && message.clientId !== this.clientId) {
      return this.blockLocalChanges(message, 'client-id-mismatch');
    }

    const hasFreshUserIntent = this.intentSerial > this.lastWriteIntentSerial;
    const hasProvenReplayPermit = this.automaticReplayBudget > 0 && !this.automaticWritesBlocked;
    if (!hasFreshUserIntent && !hasProvenReplayPermit) {
      return this.blockLocalChanges(message, 'local-write-without-new-user-intent');
    }

    if (hasFreshUserIntent) {
      this.lastWriteIntentSerial = this.intentSerial;
      this.automaticReplayBudget = 0;
    } else {
      this.automaticReplayBudget -= 1;
    }

    const operation: KnownOperation = {
      clientId: message.clientId,
      opId: message.opId,
      baseVersion: message.baseVersion,
      settled: false
    };
    if (this.hostText !== undefined && this.hostVersion === message.baseVersion) {
      operation.baseText = this.hostText;
      try {
        operation.resultText = applyTextChanges(this.hostText, message.changes);
      } catch {
        return this.blockLocalChanges(message, 'invalid-local-change-batch');
      }
    }
    this.rememberOperation(operation);
    return { kind: 'forward' };
  }

  /** HostからWebviewへ届くメッセージを検査し、古い通知と危険な再送指示を除去する。 */
  handleInbound(message: HostToWebviewMessage): SyncSafetyInboundDecision {
    switch (message.type) {
      case 'init':
        this.hostText = message.text;
        this.hostVersion = message.version;
        return { kind: 'forward', message };
      case 'editAck':
        return this.handleAck(message);
      case 'externalChanges':
        return this.handleExternalChanges(message);
      case 'resyncRequired':
        return this.handleResync(message);
      default:
        return { kind: 'forward', message };
    }
  }

  /** テストと診断用に、本文そのものを含まない安全状態を返す。 */
  snapshot(): SyncSafetySnapshot {
    return {
      intentSerial: this.intentSerial,
      lastWriteIntentSerial: this.lastWriteIntentSerial,
      hostVersion: this.hostVersion,
      hostTextKnown: this.hostText !== undefined,
      resyncStreak: this.resyncStreak,
      automaticReplayBudget: this.automaticReplayBudget,
      automaticWritesBlocked: this.automaticWritesBlocked,
      blockedWriteStreak: this.blockedWriteStreak,
      pendingOperationIds: Array.from(this.operations.values())
        .filter((operation) => !operation.settled)
        .map((operation) => operation.opId)
    };
  }

  private handleAck(
    message: Extract<HostToWebviewMessage, { type: 'editAck' }>
  ): SyncSafetyInboundDecision {
    const operation = this.operations.get(operationIdentity(message.clientId, message.opId));
    if (operation?.settled && this.hostVersion !== undefined && message.version <= this.hostVersion) {
      return { kind: 'drop', reason: 'stale-settled-ack' };
    }
    this.advanceHostByChanges(message.baseVersion, message.version, message.changes);
    if (operation) this.settleOperation(operation, message.version);
    this.automaticReplayBudget = 0;
    return { kind: 'forward', message };
  }

  private handleExternalChanges(
    message: Extract<HostToWebviewMessage, { type: 'externalChanges' }>
  ): SyncSafetyInboundDecision {
    if (this.hostVersion !== undefined && message.version <= this.hostVersion) {
      return { kind: 'drop', reason: 'stale-external-change' };
    }
    this.advanceHostByChanges(message.baseVersion, message.version, message.changes);
    if (message.clientId && message.opId) {
      const operation = this.operations.get(operationIdentity(message.clientId, message.opId));
      if (operation) this.settleOperation(operation, message.version);
    }
    return { kind: 'forward', message };
  }

  private handleResync(message: ResyncMessage): SyncSafetyInboundDecision {
    const previousVersion = this.hostVersion;
    const previousText = this.hostText;
    if (previousVersion !== undefined && message.version < previousVersion) {
      return { kind: 'drop', reason: 'stale-resync-snapshot' };
    }

    const operation = message.opId
      ? this.operations.get(operationIdentity(message.clientId, message.opId))
      : undefined;
    if (operation?.settled
      && previousVersion !== undefined
      && message.version <= previousVersion
      && previousText === message.text) {
      return { kind: 'drop', reason: 'delayed-resync-for-settled-operation' };
    }

    this.hostText = message.text;
    this.hostVersion = message.version;
    if (this.lastResyncIntentSerial === this.intentSerial) {
      this.resyncStreak += 1;
    } else {
      this.lastResyncIntentSerial = this.intentSerial;
      this.resyncStreak = 1;
    }
    if (this.resyncStreak >= 2) this.automaticWritesBlocked = true;

    if (!message.opId) {
      // opIdなしの再同期からAppがローカル差分を再構成しても、書き込みゲート側で
      // 新しいユーザー意図がない自動localChangesを遮断する。
      return { kind: 'forward', message };
    }

    if (!operation) {
      // 自分が送信したと証明できない操作を「未適用」として再演しない。
      if (message.operationApplied === true) return { kind: 'forward', message };
      return {
        kind: 'forward',
        message: { ...message, operationApplied: true }
      };
    }

    if (message.operationApplied === true) {
      this.settleOperation(operation, message.version);
      this.automaticReplayBudget = 0;
      return { kind: 'forward', message };
    }

    const provenNotApplied = message.operationApplied === false
      && !operation.settled
      && operation.baseText !== undefined
      && message.version === operation.baseVersion
      && message.text === operation.baseText
      && this.resyncStreak === 1
      && !this.automaticWritesBlocked;

    if (provenNotApplied) {
      // 同一本文・同一versionなので、この操作が現Host本文へ一度も入っていないことを証明できる。
      // Appが再構成するlocalChangesを、ここから1件だけ例外的に許可する。
      this.settleOperation(operation, message.version);
      this.automaticReplayBudget = 1;
      return { kind: 'forward', message };
    }

    // false/undefinedでも証明できなければ「適用済み」側へ倒す。
    // 文字欠落の可能性より、同じ挿入を再送し続ける事故を構造的に優先して防ぐ。
    this.settleOperation(operation, message.version);
    this.automaticReplayBudget = 0;
    if (this.resyncStreak >= 2) this.automaticWritesBlocked = true;
    return {
      kind: 'forward',
      message: { ...message, operationApplied: true }
    };
  }

  private blockLocalChanges(message: LocalChangesMessage, reason: string): SyncSafetyOutboundDecision {
    this.automaticReplayBudget = 0;
    this.automaticWritesBlocked = true;
    this.blockedWriteStreak += 1;
    return {
      kind: 'block',
      reason,
      recovery: {
        type: 'requestResync',
        clientId: message.clientId,
        opId: message.opId,
        version: this.hostVersion ?? message.baseVersion,
        reason: `sync-safety-guard:${reason}`
      }
    };
  }

  private advanceHostByChanges(
    baseVersion: number,
    version: number,
    changes: Extract<HostToWebviewMessage, { type: 'editAck' | 'externalChanges' }>['changes']
  ): void {
    if (this.hostText !== undefined && this.hostVersion === baseVersion) {
      try {
        this.hostText = applyTextChanges(this.hostText, changes);
        this.hostVersion = version;
        return;
      } catch {
        // Host通知自体はAppへ渡すが、次のauthoritative resyncまで本文ミラーを信用しない。
      }
    }
    this.hostText = undefined;
    this.hostVersion = version;
  }

  private settleOperation(operation: KnownOperation, version: number): void {
    operation.settled = true;
    operation.settledVersion = version;
  }

  private rememberOperation(operation: KnownOperation): void {
    this.operations.set(operationIdentity(operation.clientId, operation.opId), operation);
    while (this.operations.size > 512) {
      const settled = Array.from(this.operations.entries()).find(([, candidate]) => candidate.settled);
      const oldestKey = settled?.[0] ?? this.operations.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.operations.delete(oldestKey);
    }
  }
}

function operationIdentity(clientId: string, opId: string): string {
  return `${clientId}\u0000${opId}`;
}
