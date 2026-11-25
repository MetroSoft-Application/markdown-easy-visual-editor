/**
 * @fileoverview Extension Host が使う globalState のキーと、markdownEasyVisualEditor.* 設定キーを一元定義する。
 * キー文字列は保存済みのユーザー設定・状態と互換性を保つ必要があるため、値を変更しない。
 */


/**
 * globalStateで表示モードを保存するキー。
 */
export const VIEW_MODE_STATE_KEY = 'markdownEasyVisualEditor.viewMode';

/**
 * globalStateで目次表示状態を保存するキー。
 */
export const OUTLINE_VISIBLE_STATE_KEY = 'markdownEasyVisualEditor.outlineVisible';

/**
 * スクロール同期設定を保存するキー。
 */
export const SCROLL_SYNC_STATE_KEY = 'markdownEasyVisualEditor.scrollSyncEnabled';

/**
 * 画像リサイズUIの状態を保存するキー。
 */
export const PREVIEW_IMAGE_RESIZE_CONTROLS_STATE_KEY = 'markdownEasyVisualEditor.previewImageResizeControlsVisible';

/**
 * globalStateでPDF設定を保存するキー。
 */
export const PDF_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.pdfOptions';

/**
 * globalStateでフォント設定を保存するキー。
 */
export const FONT_FAMILY_STATE_KEY = 'markdownEasyVisualEditor.fontFamilies';

/**
 * globalStateでHTML出力設定を保存するキー。
 */
export const HTML_OPTIONS_STATE_KEY = 'markdownEasyVisualEditor.htmlOptions';

/** 旧globalState形式の設定移行を一度だけ実行したか記録するキー。 */
export const GLOBAL_SETTINGS_MIGRATION_STATE_KEY = 'markdownEasyVisualEditor.globalSettingsMigrated';

/** VS CodeのmarkdownEasyVisualEditor設定へ保存するキーを一元管理する。 */
export const GLOBAL_CONFIGURATION_KEYS = {
    viewMode: 'editor.viewMode',
    outlineVisible: 'editor.outlineVisible',
    scrollSyncEnabled: 'editor.scrollSyncEnabled',
    previewImageResizeControlsVisible: 'preview.imageResizeControlsVisible',
    /** 見出しの自動番号付け。`off` / `h1` / `h2`。旧globalStateの値はないため移行しない。 */
    headingNumbering: 'preview.headingNumbering',
    editorFontFamily: 'fonts.editorFamily',
    previewFontFamily: 'fonts.previewFamily',
    mermaidFontSize: 'mermaid.fontSize',
    pdf: {
        format: 'pdf.format',
        orientation: 'pdf.orientation',
        marginTop: 'pdf.margins.top',
        marginRight: 'pdf.margins.right',
        marginBottom: 'pdf.margins.bottom',
        marginLeft: 'pdf.margins.left',
        header: 'pdf.header',
        footer: 'pdf.footer',
        bodyFontSize: 'pdf.bodyFontSize',
        headingFontSizeH1: 'pdf.headingFontSizes.h1',
        headingFontSizeH2: 'pdf.headingFontSizes.h2',
        headingFontSizeH3: 'pdf.headingFontSizes.h3',
        headingFontSizeH4: 'pdf.headingFontSizes.h4',
        headingFontSizeH5: 'pdf.headingFontSizes.h5',
        headingFontSizeH6: 'pdf.headingFontSizes.h6',
        codeFontSize: 'pdf.codeFontSize',
        lineHeight: 'pdf.lineHeight',
        paragraphSpacing: 'pdf.paragraphSpacing',
        saveWithoutDialog: 'pdf.saveWithoutDialog'
    },
    output: {
        textReplacements: 'output.textReplacements'
    },
    html: {
        embedImages: 'html.embedImages',
        convertLinkedMarkdown: 'html.convertLinkedMarkdown',
        showOutlineSidebar: 'html.showOutlineSidebar',
        saveWithoutDialog: 'html.saveWithoutDialog'
    },
    /** DOCX出力だけで切り替える設定。用紙・余白・文字組みはpdf.*を共用する。 */
    docx: {
        saveWithoutDialog: 'docx.saveWithoutDialog'
    }
} as const;
