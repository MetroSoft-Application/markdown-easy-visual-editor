import type { Diagnostic } from './markdown';
import type { SupportedLanguage } from './messages';

export type EditorMode = 'split' | 'preview';
export type EditorTheme = 'light' | 'dark';

export interface ImagePayload {
  name?: string;
  mime: string;
  base64: string;
}

export interface PdfOptions {
  format: 'A3' | 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  header: string;
  footer: string;
  saveWithoutDialog: boolean;
}

export interface HtmlExportOptions {
  embedImages: boolean;
  convertLinkedMarkdown: boolean;
  saveWithoutDialog: boolean;
}

export interface WebviewSettings {
  language: SupportedLanguage;
  imageDirectory: string;
  maxPasteSizeMb: number;
  remoteImagesEnabled: boolean;
  mermaidTheme: 'auto' | 'default' | 'dark' | 'neutral';
  editorTheme?: EditorTheme;
  workspaceTrusted: boolean;
}

export interface TextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export type HostToWebviewMessage =
  | {
      type: 'init';
      text: string;
      version: number;
      uri: string;
      settings: WebviewSettings;
    }
  | { type: 'editAck'; clientId: string; opId: string; baseVersion: number; version: number; changes: TextChange[] }
  | { type: 'externalChanges'; baseVersion: number; version: number; changes: TextChange[]; clientId?: string; opId?: string }
  | {
      type: 'resyncRequired';
      clientId: string;
      opId?: string;
      operationApplied?: boolean;
      text: string;
      version: number;
      reason: string;
    }
  | { type: 'settingsChanged'; settings: WebviewSettings }
  | { type: 'imagesSaved'; requestId: string; paths: string[] }
  | { type: 'localResourcesChecked'; requestId: string; diagnostics: Diagnostic[] }
  | { type: 'operationFailed'; requestId?: string; message: string }
  | { type: 'pdfExported'; requestId: string; path: string }
  | { type: 'htmlExported'; requestId: string; paths: string[] }
  | {
      type: 'renderHtmlDocuments';
      requestId: string;
      documents: Array<{ id: string; markdown: string }>;
    }
  | { type: 'pdfPreviewReady'; requestId: string; pdfBase64: string }
  | { type: 'hostCommand'; command: 'insertImage' | 'exportPdf' | 'undo' | 'redo' };

export type WebviewToHostMessage =
  | { type: 'ready'; clientId: string }
  | { type: 'localChanges'; clientId: string; opId: string; baseVersion: number; changes: TextChange[] }
  | { type: 'historyCommand'; clientId: string; command: 'undo' | 'redo' }
  | { type: 'saveImages'; requestId: string; images: ImagePayload[] }
  | { type: 'pickImage'; requestId: string }
  | { type: 'checkLocalResources'; requestId: string; markdown: string }
  | { type: 'setEditorTheme'; theme: EditorTheme }
  | {
      type: 'exportPdf';
      requestId: string;
      html: string;
      css: string;
      options: PdfOptions;
    }
  | {
      type: 'exportHtml';
      requestId: string;
      markdown: string;
      html: string;
      css: string;
      options: HtmlExportOptions;
    }
  | {
      type: 'htmlDocumentsRendered';
      requestId: string;
      documents: Array<{ id: string; html: string }>;
    }
  | {
      type: 'renderPdfPreview';
      requestId: string;
      html: string;
      css: string;
      options: PdfOptions;
    }
  | { type: 'openSource' }
  | { type: 'openResource'; href: string }
  | { type: 'requestResync'; clientId: string; opId?: string; version: number; reason: string };

export interface VsCodeApi<State = unknown> {
  postMessage(message: WebviewToHostMessage): void;
  getState(): State | undefined;
  setState(newState: State): void;
}
