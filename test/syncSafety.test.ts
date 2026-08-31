import { describe, expect, it } from 'vitest';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../src/shared/protocol';
import { SyncSafetyGuard } from '../src/webview/syncSafety';

const CLIENT = 'client-a';

function initialize(guard: SyncSafetyGuard, text = 'abc', version = 1): void {
  guard.handleOutbound({ type: 'ready', clientId: CLIENT });
  guard.handleInbound({
    type: 'init',
    text,
    version,
    uri: 'file:///test.md',
    settings: {
      language: 'ja',
      imageDirectory: 'assets/${documentBasename}',
      maxPasteSizeMb: 20,
      remoteImagesEnabled: false,
      mermaidTheme: 'default',
      workspaceTrusted: true
    }
  });
}

function insertion(opId: string, text: string, offset = 3, baseVersion = 1): Extract<WebviewToHostMessage, { type: 'localChanges' }> {
  return {
    type: 'localChanges',
    clientId: CLIENT,
    opId,
    baseVersion,
    changes: [{ rangeOffset: offset, rangeLength: 0, text }]
  };
}

describe('SyncSafetyGuard', () => {
  it('blocks a local write that has no new user mutation intent', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);

    const decision = guard.handleOutbound(insertion('op-1', 'x'));

    expect(decision.kind).toBe('block');
    if (decision.kind === 'block') {
      expect(decision.recovery.type).toBe('requestResync');
      expect(decision.recovery.opId).toBe('op-1');
    }
    expect(guard.snapshot().automaticWritesBlocked).toBe(true);
  });

  it('allows at most one local write per user intent and reopens only for a new intent', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);
    guard.noteMutationIntent('typing');

    expect(guard.handleOutbound(insertion('op-1', 'x')).kind).toBe('forward');
    expect(guard.handleOutbound(insertion('op-2', 'y')).kind).toBe('block');

    guard.noteMutationIntent('typing-again');
    expect(guard.handleOutbound(insertion('op-3', 'z')).kind).toBe('forward');
  });

  it('permits exactly one automatic replay only when not-applied is proven by identical text and version', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);
    guard.noteMutationIntent('typing');
    expect(guard.handleOutbound(insertion('op-1', 'x')).kind).toBe('forward');

    const firstResync = guard.handleInbound({
      type: 'resyncRequired',
      clientId: CLIENT,
      opId: 'op-1',
      operationApplied: false,
      text: 'abc',
      version: 1,
      reason: 'not applied'
    });
    expect(firstResync.kind).toBe('forward');
    if (firstResync.kind === 'forward' && firstResync.message.type === 'resyncRequired') {
      expect(firstResync.message.operationApplied).toBe(false);
    }
    expect(guard.snapshot().automaticReplayBudget).toBe(1);

    expect(guard.handleOutbound(insertion('op-retry', 'x')).kind).toBe('forward');
    expect(guard.snapshot().automaticReplayBudget).toBe(0);
  });

  it('closes the automatic write gate on a second resync without new user input', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);
    guard.noteMutationIntent('typing');
    expect(guard.handleOutbound(insertion('op-1', 'x')).kind).toBe('forward');

    guard.handleInbound({
      type: 'resyncRequired',
      clientId: CLIENT,
      opId: 'op-1',
      operationApplied: false,
      text: 'abc',
      version: 1,
      reason: 'first failure'
    });
    expect(guard.handleOutbound(insertion('op-retry', 'x')).kind).toBe('forward');

    const secondResync = guard.handleInbound({
      type: 'resyncRequired',
      clientId: CLIENT,
      opId: 'op-retry',
      operationApplied: false,
      text: 'abc',
      version: 1,
      reason: 'second failure'
    });
    expect(secondResync.kind).toBe('forward');
    if (secondResync.kind === 'forward' && secondResync.message.type === 'resyncRequired') {
      expect(secondResync.message.operationApplied).toBe(true);
    }
    expect(guard.snapshot()).toMatchObject({
      resyncStreak: 2,
      automaticReplayBudget: 0,
      automaticWritesBlocked: true
    });
    expect(guard.handleOutbound(insertion('op-third', 'x')).kind).toBe('block');
  });

  it('never replays an operation when the resync snapshot differs from its exact base', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);
    guard.noteMutationIntent('typing');
    expect(guard.handleOutbound(insertion('op-1', 'x')).kind).toBe('forward');

    const decision = guard.handleInbound({
      type: 'resyncRequired',
      clientId: CLIENT,
      opId: 'op-1',
      operationApplied: false,
      text: 'remote-abc',
      version: 2,
      reason: 'ambiguous state'
    });

    expect(decision.kind).toBe('forward');
    if (decision.kind === 'forward' && decision.message.type === 'resyncRequired') {
      expect(decision.message.operationApplied).toBe(true);
    }
    expect(guard.snapshot().automaticReplayBudget).toBe(0);
  });

  it('drops stale external changes after a newer authoritative snapshot', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard, 'new', 5);

    const stale: HostToWebviewMessage = {
      type: 'externalChanges',
      baseVersion: 3,
      version: 4,
      changes: [{ rangeOffset: 0, rangeLength: 0, text: 'old' }]
    };
    expect(guard.handleInbound(stale)).toMatchObject({ kind: 'drop', reason: 'stale-external-change' });
  });

  it('drops a delayed resync for an operation that already received its ACK', () => {
    const guard = new SyncSafetyGuard();
    initialize(guard);
    guard.noteMutationIntent('typing');
    expect(guard.handleOutbound(insertion('op-1', 'x')).kind).toBe('forward');
    guard.handleInbound({
      type: 'editAck',
      clientId: CLIENT,
      opId: 'op-1',
      baseVersion: 1,
      version: 2,
      changes: [{ rangeOffset: 3, rangeLength: 0, text: 'x' }]
    });

    expect(guard.handleInbound({
      type: 'resyncRequired',
      clientId: CLIENT,
      opId: 'op-1',
      operationApplied: true,
      text: 'abcx',
      version: 2,
      reason: 'late duplicate'
    })).toMatchObject({ kind: 'drop', reason: 'delayed-resync-for-settled-operation' });
  });
});
