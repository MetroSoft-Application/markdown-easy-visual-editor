import type {
  HostToWebviewMessage,
  VsCodeApi,
  WebviewSettings,
  WebviewToHostMessage,
} from "../shared/protocol";
import { sharedVsCodeApi } from "./vscodeApi";

interface OutlinePersistedState extends Record<string, unknown> {
  outlineVisible?: boolean;
}

interface OutlineBootstrap {
  settings?: WebviewSettings;
}

let installed = false;

/**
 * アウトライン表示状態をExtension HostのglobalStateへ一本化する。
 * Appが既存のWebview状態へoutlineVisibleを書き込んでも保存対象から除外し、
 * 起動時はHostが埋め込んだグローバル値をgetStateへ合成する。
 * 他のWebviewで変更された場合は既存UI操作を通してReact状態へ反映する。
 */
export function installOutlineVisibilityController(): () => void {
  if (installed) return () => undefined;
  installed = true;

  const api = sharedVsCodeApi as VsCodeApi<OutlinePersistedState>;
  const nativeGetState = api.getState.bind(api);
  const nativeSetState = api.setState.bind(api);
  const nativePostMessage = api.postMessage.bind(api);
  const bootstrap = (
    globalThis as typeof globalThis & { __mveBootstrap?: OutlineBootstrap }
  ).__mveBootstrap;

  let globalVisible = bootstrap?.settings?.outlineVisible !== false;
  let hostSyncPending = false;
  let syncFrame = 0;

  api.getState = () => ({
    ...(nativeGetState() ?? {}),
    outlineVisible: globalVisible,
  });

  api.setState = (nextState) => {
    const { outlineVisible, ...persisted } = nextState ?? {};
    nativeSetState(persisted);

    if (
      typeof outlineVisible !== "boolean" ||
      outlineVisible === globalVisible ||
      hostSyncPending
    ) {
      return;
    }

    // ローカルUI操作を先にグローバル値へ反映し、Hostの同値broadcastでは再送しない。
    globalVisible = outlineVisible;
    nativePostMessage({
      type: "setOutlineVisible",
      visible: outlineVisible,
    } satisfies WebviewToHostMessage);
  };

  const currentDomVisibility = (): boolean | undefined => {
    if (document.querySelector(".outline-panel")) return true;
    if (document.querySelector(".outline-reopen")) return false;
    return undefined;
  };

  const synchronizeReactState = () => {
    syncFrame = 0;
    if (!hostSyncPending) return;

    const current = currentDomVisibility();
    if (current === globalVisible) {
      hostSyncPending = false;
      return;
    }

    const control = globalVisible
      ? document.querySelector<HTMLButtonElement>("button.outline-reopen")
      : document.querySelector<HTMLButtonElement>(
          ".outline-panel .outline-header button",
        );
    if (control && !control.disabled) control.click();
  };

  const scheduleSynchronization = () => {
    if (!hostSyncPending || syncFrame) return;
    syncFrame = window.requestAnimationFrame(synchronizeReactState);
  };

  const acceptHostVisibility = (settings: WebviewSettings) => {
    const visible = settings.outlineVisible !== false;
    if (visible === globalVisible && !hostSyncPending) return;
    globalVisible = visible;
    hostSyncPending = currentDomVisibility() !== visible;
    scheduleSynchronization();
  };

  const onMessage = (event: MessageEvent<HostToWebviewMessage>) => {
    const message = event.data;
    if (message.type === "init" || message.type === "settingsChanged") {
      acceptHostVisibility(message.settings);
    }
  };

  const observer = new MutationObserver(() => scheduleSynchronization());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("message", onMessage);

  return () => {
    if (syncFrame) window.cancelAnimationFrame(syncFrame);
    observer.disconnect();
    window.removeEventListener("message", onMessage);
    api.getState = nativeGetState;
    api.setState = nativeSetState;
    installed = false;
  };
}
