/**
 * @fileoverview HostとWebviewで使う表示文言とローカライズキーを対応付ける。未登録キーのフォールバックを一貫させる。
 */
import localeCatalog from './locales.json';
import type { TextColorId } from './textColor';


/**
 * ローカライズ辞書が提供する言語コードの一覧。
 */
export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
/**
 * ローカライズ辞書が提供する言語コード。
 */
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
/**
 * 表示言語の自動判定または明示指定。
 */
export type LanguageSetting = 'auto' | SupportedLanguage;

/**
 * 表示文言で送受信するメッセージまたは要求のデータ形状。
 */
export interface Messages {

    /**
     * リボンで表示する文言をまとめた辞書。
     */
    ribbon: {

        /**
         * リボンのタブ名をまとめた辞書。
         */
        tabs: {
            /**
             * ホームタブとして表示するローカライズ済み文言。
             */
            home: string;
            /**
             * 挿入タブとして表示するローカライズ済み文言。
             */
            insert: string;
            /**
             * 表タブとして表示するローカライズ済み文言。
             */
            table: string;
            /**
             * 表示タブとして表示するローカライズ済み文言。
             */
            view: string;
            /**
             * 出力タブとして表示するローカライズ済み文言。
             */
            export: string;
            /**
             * 設定タブとして表示するローカライズ済み文言。
             */
            settings: string;
            /**
             * ヘルプタブとして表示するローカライズ済み文言。
             */
            help: string
        };

        /**
         * 表示項目「表示文言」の文言として表示するローカライズ済み文言。
         */
        label: string;

        /**
         * 表示項目「source」の文言として表示するローカライズ済み文言。
         */
        source: string;

        /**
         * 本文編集面の見出しとして表示するローカライズ済み文言。
         */
        sourceTitle: string;

        /**
         * outline設定の表示文言として表示するローカライズ済み文言。
         */
        outline: string;

        /**
         * 目次の見出しとして表示するローカライズ済み文言。
         */
        outlineTitle: string;

        /**
         * 表示項目「スクロール同期」の文言として表示するローカライズ済み文言。
         */
        scrollSync: string;

        /**
         * スクロール同期設定の見出しとして表示するローカライズ済み文言。
         */
        scrollSyncTitle: string;

        /**
         * 表示項目「search」の文言として表示するローカライズ済み文言。
         */
        search: string;

        /**
         * split設定の表示文言として表示するローカライズ済み文言。
         */
        split: string;

        /**
         * 表示項目「本文のみ表示」の文言として表示するローカライズ済み文言。
         */
        textOnly: string;

        /**
         * プレビューのみ表示設定の表示文言として表示するローカライズ済み文言。
         */
        previewOnly: string;

        /**
         * 表示項目「pin」の文言として表示するローカライズ済み文言。
         */
        pin: string;

        /**
         * 表示項目「unpin」の文言として表示するローカライズ済み文言。
         */
        unpin: string;

        /**
         * 表示項目「collapse」の文言として表示するローカライズ済み文言。
         */
        collapse: string;

        /**
         * 表示項目「expand」の文言として表示するローカライズ済み文言。
         */
        expand: string;

        /**
         * 表示文言のgroupsに関する状態または設定。
         */
        groups: {

            /**
             * 表示項目「履歴」の文言として表示するローカライズ済み文言。
             */
            history: string;

            /**
             * 表示項目「段落」の文言として表示するローカライズ済み文言。
             */
            paragraph: string;

            /**
             * 表示項目「文字書式」の文言として表示するローカライズ済み文言。
             */
            textFormat: string;

            /**
             * 解除操作のラベルとして表示するローカライズ済み文言。
             */
            clear: string;

            /**
             * 表示項目「basic」の文言として表示するローカライズ済み文言。
             */
            basic: string;

            /**
             * 表示項目「block」の文言として表示するローカライズ済み文言。
             */
            block: string;

            /**
             * 表示項目「assist」の文言として表示するローカライズ済み文言。
             */
            assist: string;

            /**
             * 表示項目「rows」の文言として表示するローカライズ済み文言。
             */
            rows: string;

            /**
             * 表示項目「columns」の文言として表示するローカライズ済み文言。
             */
            columns: string;

            /**
             * 表示項目「alignment」の文言として表示するローカライズ済み文言。
             */
            alignment: string;

            /**
             * 表示項目「excel」の文言として表示するローカライズ済み文言。
             */
            excel: string;

            /**
             * 表示項目「pane」の文言として表示するローカライズ済み文言。
             */
            pane: string;

            /**
             * 表示項目「pdf」の文言として表示するローカライズ済み文言。
             */
            pdf: string;

            /**
             * 表示項目「html」の文言として表示するローカライズ済み文言。
             */
            html: string;

            /**
             * 表示項目「inspection」の文言として表示するローカライズ済み文言。
             */
            inspection: string;

            /**
             * プレビュー操作のグループ名。
             */
            preview: string;

            /**
             * テーマ操作のグループ名。
             */
            theme: string;

            /**
             * ヘルプタブとして表示するローカライズ済み文言。
             */
            help: string;
        };

        /**
         * 表示文言のlabelsに関する状態または設定。
         */
        labels: {

            /**
             * 元に戻す操作のラベルとして表示するローカライズ済み文言。
             */
            undo: string;

            /**
             * やり直す操作のラベルとして表示するローカライズ済み文言。
             */
            redo: string;

            /**
             * 表示項目「style」の文言として表示するローカライズ済み文言。
             */
            style: string;

            /**
             * 表示項目「body」の文言として表示するローカライズ済み文言。
             */
            body: string;
            /**
             * 表示文言のheadingを処理し、呼び出し側へ結果または副作用を返す。
             * @param level - 表示文言で扱う数値。
             * @returns 表示文言で利用する文字列。
             */
            heading: (level: number) => string;

            /**
             * 引用書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            quote: string;

            /**
             * 箇条書き書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            bulletList: string;

            /**
             * 番号付きリスト書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            orderedList: string;

            /**
             * タスクリスト書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            taskList: string;

            /**
             * 表示項目「indent」の文言として表示するローカライズ済み文言。
             */
            indent: string;

            /**
             * 表示項目「outdent」の文言として表示するローカライズ済み文言。
             */
            outdent: string;

            /**
             * 太字書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            bold: string;

            /**
             * 斜体書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            italic: string;

            /**
             * 取り消し線書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            strike: string;

            /**
             * 下線書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            underline: string;

            /**
             * 表示項目「highlight」の文言として表示するローカライズ済み文言。
             */
            highlight: string;

            /**
             * コード書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            code: string;

            /**
             * 表示項目「superscript」の文言として表示するローカライズ済み文言。
             */
            superscript: string;

            /**
             * 表示項目「subscript」の文言として表示するローカライズ済み文言。
             */
            subscript: string;

            /**
             * インライン書式解除操作のラベルとして表示するローカライズ済み文言。
             */
            clearInline: string;

            /**
             * ブロック書式解除操作のラベルとして表示するローカライズ済み文言。
             */
            clearBlock: string;

            /**
             * clear・all操作のラベルとして表示するローカライズ済み文言。
             */
            clearAll: string;

            /**
             * unlink書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            unlink: string;

            /**
             * リンク書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            link: string;

            /**
             * 画像書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            image: string;

            /**
             * 表示項目「table・size」の文言として表示するローカライズ済み文言。
             */
            tableSize: string;

            /**
             * 表示項目「rows」の文言として表示するローカライズ済み文言。
             */
            rows: string;

            /**
             * 表示項目「columns」の文言として表示するローカライズ済み文言。
             */
            columns: string;

            /**
             * insert・table操作のラベルとして表示するローカライズ済み文言。
             */
            insertTable: string;

            /**
             * 表示項目「horizontal・rule」の文言として表示するローカライズ済み文言。
             */
            horizontalRule: string;

            /**
             * 表示項目「hard・break」の文言として表示するローカライズ済み文言。
             */
            hardBreak: string;

            /**
             * 表示項目「language」の文言として表示するローカライズ済み文言。
             */
            language: string;

            /**
             * code・block書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            codeBlock: string;

            /**
             * 表示項目「math」の文言として表示するローカライズ済み文言。
             */
            math: string;

            /**
             * 表示項目「footnote」の文言として表示するローカライズ済み文言。
             */
            footnote: string;

            /**
             * 表示項目「toc」の文言として表示するローカライズ済み文言。
             */
            toc: string;

            /**
             * 文字色操作のラベル。
             */
            textColor: string;

            /**
             * 画像リサイズ操作のラベル。
             */
            imageResize: string;

            /**
             * プレビュー画像リサイズ操作の説明。
             */
            imageResizeControls: string;

            /**
             * エディターテーマ選択のラベル。
             */
            editorTheme: string;

            /**
             * 明るいテーマのラベル。
             */
            light: string;

            /**
             * 暗いテーマのラベル。
             */
            dark: string;

            /**
             * 表示項目「page・break」の文言として表示するローカライズ済み文言。
             */
            pageBreak: string;

            /**
             * 表示項目「emoji」の文言として表示するローカライズ済み文言。
             */
            emoji: string;

            /**
             * insert・emoji操作のラベルとして表示するローカライズ済み文言。
             */
            insertEmoji: string;

            /**
             * add・before操作のラベルとして表示するローカライズ済み文言。
             */
            addBefore: string;

            /**
             * add・after操作のラベルとして表示するローカライズ済み文言。
             */
            addAfter: string;

            /**
             * add・left操作のラベルとして表示するローカライズ済み文言。
             */
            addLeft: string;

            /**
             * add・right操作のラベルとして表示するローカライズ済み文言。
             */
            addRight: string;

            /**
             * delete・row操作のラベルとして表示するローカライズ済み文言。
             */
            deleteRow: string;

            /**
             * 表示項目「toggle・header」の文言として表示するローカライズ済み文言。
             */
            toggleHeader: string;

            /**
             * delete・column操作のラベルとして表示するローカライズ済み文言。
             */
            deleteColumn: string;

            /**
             * 表示項目「align・left」の文言として表示するローカライズ済み文言。
             */
            alignLeft: string;

            /**
             * 表示項目「align・center」の文言として表示するローカライズ済み文言。
             */
            alignCenter: string;

            /**
             * 表示項目「align・right」の文言として表示するローカライズ済み文言。
             */
            alignRight: string;

            /**
             * 表示項目「align・columns」の文言として表示するローカライズ済み文言。
             */
            alignColumns: string;

            /**
             * 表示項目「cell・break」の文言として表示するローカライズ済み文言。
             */
            cellBreak: string;

            /**
             * copy・tsv操作のラベルとして表示するローカライズ済み文言。
             */
            copyTsv: string;

            /**
             * print・preview設定の表示文言として表示するローカライズ済み文言。
             */
            printPreview: string;

            /**
             * 表示項目「export・pdf」の文言として表示するローカライズ済み文言。
             */
            exportPdf: string;

            /**
             * 表示項目「export・html」の文言として表示するローカライズ済み文言。
             */
            exportHtml: string;

            /**
             * embed・images書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            embedImages: string;

            /**
             * convert・linked・markdown書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            convertLinkedMarkdown: string;

            /**
             * save・without・dialog操作のラベルとして表示するローカライズ済み文言。
             */
            saveWithoutDialog: string;

            /**
             * 表示項目「preflight」の文言として表示するローカライズ済み文言。
             */
            preflight: string;

            /**
             * 表示項目「shortcuts」の文言として表示するローカライズ済み文言。
             */
            shortcuts: string;

            /**
             * 表示項目「features」の文言として表示するローカライズ済み文言。
             */
            features: string;

            /**
             * 表示項目「markdown・support」の文言として表示するローカライズ済み文言。
             */
            markdownSupport: string;

            /**
             * 画面または設定項目の説明として表示するローカライズ済み文言。
             */
            about: string;

            /**
             * 表示項目「header」の文言として表示するローカライズ済み文言。
             */
            header: string;

            /**
             * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
             */
            headerPlaceholder: string;
        };

        /**
         * 表示文言のfeature・descriptionsに関する状態または設定。
         */
        featureDescriptions: {

            /**
             * 元に戻す操作のラベルとして表示するローカライズ済み文言。
             */
            undo: string;

            /**
             * やり直す操作のラベルとして表示するローカライズ済み文言。
             */
            redo: string;

            /**
             * 太字書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            bold: string;

            /**
             * 斜体書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            italic: string;

            /**
             * インライン書式解除操作のラベルとして表示するローカライズ済み文言。
             */
            clearInline: string;

            /**
             * ブロック書式解除操作のラベルとして表示するローカライズ済み文言。
             */
            clearBlock: string;

            /**
             * リンク書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            link: string;

            /**
             * 画像書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            image: string;

            /**
             * insert・table操作のラベルとして表示するローカライズ済み文言。
             */
            insertTable: string;

            /**
             * code・block書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            codeBlock: string;

            /**
             * 表示項目「math」の文言として表示するローカライズ済み文言。
             */
            math: string;

            /**
             * 表示項目「footnote」の文言として表示するローカライズ済み文言。
             */
            footnote: string;

            /**
             * 表示項目「toc」の文言として表示するローカライズ済み文言。
             */
            toc: string;

            /**
             * add・before操作のラベルとして表示するローカライズ済み文言。
             */
            addBefore: string;

            /**
             * delete・row操作のラベルとして表示するローカライズ済み文言。
             */
            deleteRow: string;

            /**
             * delete・column操作のラベルとして表示するローカライズ済み文言。
             */
            deleteColumn: string;

            /**
             * 表示項目「align・left」の文言として表示するローカライズ済み文言。
             */
            alignLeft: string;

            /**
             * 表示項目「align・center」の文言として表示するローカライズ済み文言。
             */
            alignCenter: string;

            /**
             * 表示項目「align・right」の文言として表示するローカライズ済み文言。
             */
            alignRight: string;

            /**
             * copy・tsv操作のラベルとして表示するローカライズ済み文言。
             */
            copyTsv: string;

            /**
             * table・editor設定の表示文言として表示するローカライズ済み文言。
             */
            tableEditor: string;

            /**
             * table・editor・column・resize設定の表示文言として表示するローカライズ済み文言。
             */
            tableEditorColumnResize: string;

            /**
             * table・editor・row・resize設定の表示文言として表示するローカライズ済み文言。
             */
            tableEditorRowResize: string;

            /**
             * table・editor・layout設定の表示文言として表示するローカライズ済み文言。
             */
            tableEditorLayout: string;

            /**
             * outline設定の表示文言として表示するローカライズ済み文言。
             */
            outline: string;

            /**
             * 表示項目「search」の文言として表示するローカライズ済み文言。
             */
            search: string;

            /**
             * split設定の表示文言として表示するローカライズ済み文言。
             */
            split: string;

            /**
             * 表示項目「本文のみ表示」の文言として表示するローカライズ済み文言。
             */
            textOnly: string;

            /**
             * プレビューのみ表示設定の表示文言として表示するローカライズ済み文言。
             */
            previewOnly: string;

            /**
             * print・preview設定の表示文言として表示するローカライズ済み文言。
             */
            printPreview: string;

            /**
             * 表示項目「export・pdf」の文言として表示するローカライズ済み文言。
             */
            exportPdf: string;

            /**
             * 表示項目「preflight」の文言として表示するローカライズ済み文言。
             */
            preflight: string;
        };

        /**
         * 表示文言のcode・languagesに関する状態または設定。
         */
        codeLanguages: ReadonlyArray<{
            /**
             * 表示項目「値」の文言として表示するローカライズ済み文言。
             */
            value: string;
            /**
             * 表示項目「表示文言」の文言として表示するローカライズ済み文言。
             */
            label: string
        }>;

        /**
         * 表示文言のsnippetsに関する状態または設定。
         */
        snippets: {
            /**
             * 表示項目「mermaid」の文言として表示するローカライズ済み文言。
             */
            mermaid: string;
            /**
             * 表示項目「footnote」の文言として表示するローカライズ済み文言。
             */
            footnote: string;
            /**
             * 表示項目「note」の文言として表示するローカライズ済み文言。
             */
            note: string;
            /**
             * 失敗または入力エラーの説明として表示するローカライズ済み文言。
             */
            warning: string
        };

        /**
         * 表示文言へ渡す設定または境界値。
         */
        settings: {

            /**
             * images書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            images: string;

            /**
             * image・directory書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            imageDirectory: string;

            /**
             * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
             */
            imageDirectoryPlaceholder: string;

            /**
             * 操作部品のツールチップとして表示するローカライズ済み文言。
             */
            imageDirectoryHint: string;

            /**
             * fonts設定の表示文言として表示するローカライズ済み文言。
             */
            fonts: string;

            /**
             * font・settings設定の表示文言として表示するローカライズ済み文言。
             */
            fontSettings: string;

            /**
             * editor・font・family設定の表示文言として表示するローカライズ済み文言。
             */
            editorFontFamily: string;

            /**
             * preview・font・family設定の表示文言として表示するローカライズ済み文言。
             */
            previewFontFamily: string;

            /**
             * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
             */
            fontFamilyPlaceholder: string;

            /**
             * 操作部品のツールチップとして表示するローカライズ済み文言。
             */
            fontFamilyHint: string;

            /**
             * 表示項目「apply」の文言として表示するローカライズ済み文言。
             */
            apply: string;
        };
    };

    /**
     * 表示文言のappに関する状態または設定。
     */
    app: {

        /**
         * 表示項目「startup」の文言として表示するローカライズ済み文言。
         */
        startup: string;

        /**
         * outline設定の表示文言として表示するローカライズ済み文言。
         */
        outline: string;

        /**
         * hide・outline設定の表示文言として表示するローカライズ済み文言。
         */
        hideOutline: string;

        /**
         * show・outline設定の表示文言として表示するローカライズ済み文言。
         */
        showOutline: string;

        /**
         * outline・width設定の表示文言として表示するローカライズ済み文言。
         */
        outlineWidth: string;

        /**
         * no・headings書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        noHeadings: string;

        /**
         * 表示項目「search・and・replace」の文言として表示するローカライズ済み文言。
         */
        searchAndReplace: string;

        /**
         * 表示項目「search・text」の文言として表示するローカライズ済み文言。
         */
        searchText: string;

        /**
         * 表示項目「replacement・text」の文言として表示するローカライズ済み文言。
         */
        replacementText: string;

        /**
         * 表示項目「replacement」の文言として表示するローカライズ済み文言。
         */
        replacement: string;

        /**
         * 表示項目「previous・match」の文言として表示するローカライズ済み文言。
         */
        previousMatch: string;

        /**
         * 表示項目「next・match」の文言として表示するローカライズ済み文言。
         */
        nextMatch: string;

        /**
         * 表示項目「replace・all」の文言として表示するローカライズ済み文言。
         */
        replaceAll: string;

        /**
         * 閉じる操作のラベルとして表示するローカライズ済み文言。
         */
        close: string;

        /**
         * split・boundary設定の表示文言として表示するローカライズ済み文言。
         */
        splitBoundary: string;

        /**
         * 表示項目「selection・formatting」の文言として表示するローカライズ済み文言。
         */
        selectionFormatting: string;

        /**
         * 画面または設定項目の見出しとして表示するローカライズ済み文言。
         */
        diagnosticsTitle: string;

        /**
         * 画面または設定項目の説明として表示するローカライズ済み文言。
         */
        diagnosticHelp: string;

        /**
         * 表示項目「no・problems」の文言として表示するローカライズ済み文言。
         */
        noProblems: string;

        /**
         * 表示文言のseverityに関する状態または設定。
         */
        severity: {
            /**
             * 失敗または入力エラーの説明として表示するローカライズ済み文言。
             */
            error: string;
            /**
             * 失敗または入力エラーの説明として表示するローカライズ済み文言。
             */
            warning: string;
            /**
             * 表示項目「info」の文言として表示するローカライズ済み文言。
             */
            info: string
        };
        /**
         * 表示文言のlineを処理し、呼び出し側へ結果または副作用を返す。
         * @param line - 表示文言の位置・寸法・件数・時間を表す数値。
         * @returns 表示文言で利用する文字列。
         */
        line: (line: number) => string;

        /**
         * 表示項目「print・settings」の文言として表示するローカライズ済み文言。
         */
        printSettings: string;

        /**
         * 画面または設定項目の説明として表示するローカライズ済み文言。
         */
        printSettingsHelp: string;

        /**
         * paper設定の表示文言として表示するローカライズ済み文言。
         */
        paper: string;

        /**
         * 表示項目「orientation」の文言として表示するローカライズ済み文言。
         */
        orientation: string;

        /**
         * 表示項目「portrait」の文言として表示するローカライズ済み文言。
         */
        portrait: string;

        /**
         * 表示項目「landscape」の文言として表示するローカライズ済み文言。
         */
        landscape: string;

        /**
         * 表示項目「header」の文言として表示するローカライズ済み文言。
         */
        header: string;

        /**
         * 表示項目「footer」の文言として表示するローカライズ済み文言。
         */
        footer: string;

        /**
         * margins設定の表示文言として表示するローカライズ済み文言。
         */
        margins: string;

        /**
         * 表示項目「top」の文言として表示するローカライズ済み文言。
         */
        top: string;

        /**
         * 表示項目「right」の文言として表示するローカライズ済み文言。
         */
        right: string;

        /**
         * 表示項目「bottom」の文言として表示するローカライズ済み文言。
         */
        bottom: string;

        /**
         * 表示項目「left」の文言として表示するローカライズ済み文言。
         */
        left: string;

        /**
         * 表示項目「without・dialog」の文言として表示するローカライズ済み文言。
         */
        withoutDialog: string;
        /**
         * 表示項目「typography」の文言として表示するローカライズ済み文言。
         */
        typography: string;

        /**
         * font・family設定の表示文言として表示するローカライズ済み文言。
         */
        fontFamily: string;

        /**
         * body・font・size設定の表示文言として表示するローカライズ済み文言。
         */
        bodyFontSize: string;

        /**
         * heading・font・sizes書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        headingFontSizes: string;

        /**
         * code・font・size書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        codeFontSize: string;

        /**
         * 表示項目「line・height」の文言として表示するローカライズ済み文言。
         */
        lineHeight: string;

        /**
         * 表示項目「paragraph・spacing」の文言として表示するローカライズ済み文言。
         */
        paragraphSpacing: string;

        /**
         * 表示文言のstatusに関する状態または設定。
         */
        status: {

            /**
             * mode・split設定の表示文言として表示するローカライズ済み文言。
             */
            modeSplit: string;

            /**
             * mode・preview設定の表示文言として表示するローカライズ済み文言。
             */
            modePreview: string;
            /**
             * 表示文言のlinesを処理し、呼び出し側へ結果または副作用を返す。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            lines: (count: number) => string;
            /**
             * 表示文言のtext・charactersを処理し、呼び出し側へ結果または副作用を返す。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            textCharacters: (count: number) => string;
            /**
             * 表示文言の変更または利用者の操作意図を記録し、後続処理へ渡す。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            markdownCharacters: (count: number) => string;
            /**
             * 表示文言のzoomを処理し、呼び出し側へ結果または副作用を返す。
             * @param percent - 表示文言で扱う数値。
             * @returns 表示文言で利用する文字列。
             */
            zoom: (percent: number) => string;

            /**
             * 表示項目「syncing」の文言として表示するローカライズ済み文言。
             */
            syncing: string;

            /**
             * 表示項目「synced」の文言として表示するローカライズ済み文言。
             */
            synced: string;
        };

        /**
         * 表示文言のinspectorに関する状態または設定。
         */
        inspector: {
            /**
             * 表示項目「mermaid」の文言として表示するローカライズ済み文言。
             */
            mermaid: string;
            /**
             * 表示項目「math」の文言として表示するローカライズ済み文言。
             */
            math: string;
            /**
             * 画像書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            image: string;
            /**
             * 表示項目「alt」の文言として表示するローカライズ済み文言。
             */
            alt: string;
            /**
             * 表示項目「reference」の文言として表示するローカライズ済み文言。
             */
            reference: string;
            /**
             * open・file操作のラベルとして表示するローカライズ済み文言。
             */
            openFile: string;
            /**
             * 表示項目「apply」の文言として表示するローカライズ済み文言。
             */
            apply: string
        };

        /**
         * 表示文言のlinkに関する状態または設定。
         */
        link: {
            /**
             * 画面または設定項目の見出しとして表示するローカライズ済み文言。
             */
            title: string;
            /**
             * 表示項目「url」の文言として表示するローカライズ済み文言。
             */
            url: string;
            /**
             * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
             */
            urlPlaceholder: string;
            /**
             * 表示項目「本文」の文言として表示するローカライズ済み文言。
             */
            text: string;
            /**
             * 操作部品のツールチップとして表示するローカライズ済み文言。
             */
            textHint: string;
            /**
             * キャンセル操作のラベルとして表示するローカライズ済み文言。
             */
            cancel: string;
            /**
             * 挿入タブとして表示するローカライズ済み文言。
             */
            insert: string
        };

        /**
         * プレビュー画像のコピー操作に使う文言。
         */
        previewImageContextMenu: {
            /**
             * 画像コピー操作のラベル。
             */
            copy: string;
            /**
             * 画像の準備中に表示する状態。
             */
            preparing: string;
            /**
             * コピー成功時に表示する通知。
             */
            copied: string;
            /**
             * コピーできない画像に表示する説明。
             */
            unavailable: string;
            /**
             * コピー失敗時に表示する通知。
             */
            failed: string;
        };

        /**
         * 文字色操作に使う文言。
         */
        textColor: {
            /**
             * 文字色操作のラベル。
             */
            label: string;
            /**
             * 既定色へ戻す選択肢のラベル。
             */
            defaultColor: string;
            /**
             * 複数の選択色が混在するときの表示。
             */
            mixed: string;
            /**
             * 文字色ごとのラベル。
             */
            colors: Record<TextColorId, string>;
        };

        /**
         * プレビュー画像の操作に使う文言。
         */
        imageControls: {
            /**
             * 画像サイズ変更操作の説明。
             */
            resize: string;
            /**
             * 画像を左揃えにする操作の説明。
             */
            alignLeft: string;
            /**
             * 左揃え操作の短い表示。
             */
            alignLeftShort: string;
            /**
             * 画像を中央揃えにする操作の説明。
             */
            alignCenter: string;
            /**
             * 中央揃え操作の短い表示。
             */
            alignCenterShort: string;
            /**
             * 画像を右揃えにする操作の説明。
             */
            alignRight: string;
            /**
             * 右揃え操作の短い表示。
             */
            alignRightShort: string;
            /**
             * 画像サイズをリセットする操作の説明。
             */
            reset: string;
        };

        /**
         * PDFプレビューに使う状態と操作の文言。
         */
        pdfPreview: {
            /**
             * PDFの縮小操作のラベル。
             */
            zoomOut: string;
            /**
             * PDFの拡大操作のラベル。
             */
            zoomIn: string;
            /**
             * PDFプレビューを表示できない状態。
             */
            unavailable: string;
            /**
             * PDF生成中の状態。
             */
            generating: string;
            /**
             * PDFページ描画中の状態。
             */
            drawing: string;
            /**
             * PDFプレビュー準備中の状態。
             */
            preparing: string;
            /**
             * ページコンポーネントでのPDF生成中の状態。
             */
            loading: string;
            /**
             * PDFプレビュー用スクリプトを読み込めない状態。
             */
            webviewUnavailable: string;
            /**
             * PDF描画失敗時に詳細を加える文。
             */
            failed: (detail: string) => string;
            /**
             * PDFページを描画できない状態。
             */
            pageError: string;
            /**
             * PDFページに付けるアクセシブル名。
             */
            pageLabel: (page: number) => string;
        };

        /**
         * 表示文言のtable・editorに関する状態または設定。
         */
        tableEditor: {

            /**
             * 画面または設定項目の見出しとして表示するローカライズ済み文言。
             */
            title: string;

            /**
             * 閉じる操作のラベルとして表示するローカライズ済み文言。
             */
            close: string;

            /**
             * add・row操作のラベルとして表示するローカライズ済み文言。
             */
            addRow: string;

            /**
             * delete・row操作のラベルとして表示するローカライズ済み文言。
             */
            deleteRow: string;

            /**
             * add・column操作のラベルとして表示するローカライズ済み文言。
             */
            addColumn: string;

            /**
             * delete・column操作のラベルとして表示するローカライズ済み文言。
             */
            deleteColumn: string;

            /**
             * 表示項目「align・left」の文言として表示するローカライズ済み文言。
             */
            alignLeft: string;

            /**
             * 表示項目「align・center」の文言として表示するローカライズ済み文言。
             */
            alignCenter: string;

            /**
             * 表示項目「align・right」の文言として表示するローカライズ済み文言。
             */
            alignRight: string;

            /**
             * clear・alignment操作のラベルとして表示するローカライズ済み文言。
             */
            clearAlignment: string;

            /**
             * copy・tsv操作のラベルとして表示するローカライズ済み文言。
             */
            copyTsv: string;

            /**
             * copy・column操作のラベルとして表示するローカライズ済み文言。
             */
            copyColumn: string;

            /**
             * copy・row操作のラベルとして表示するローカライズ済み文言。
             */
            copyRow: string;

            /**
             * キャンセル操作のラベルとして表示するローカライズ済み文言。
             */
            cancel: string;

            /**
             * 表示項目「apply」の文言として表示するローカライズ済み文言。
             */
            apply: string;

            /**
             * 操作部品のツールチップとして表示するローカライズ済み文言。
             */
            navigationHint: string;

            /**
             * source・editor・required設定の表示文言として表示するローカライズ済み文言。
             */
            sourceEditorRequired: string;

            /**
             * 表示項目「table・required」の文言として表示するローカライズ済み文言。
             */
            tableRequired: string;
            /**
             * 表示文言のrow・column・limitを処理し、呼び出し側へ結果または副作用を返す。
             * @param rows - 表示文言で走査または更新する要素。
             * @param columns - 表示文言で走査または更新する要素。
             * @returns 表示文言で利用する文字列。
             */
            rowColumnLimit: (rows: number, columns: number) => string;

            /**
             * 表示項目「copied」の文言として表示するローカライズ済み文言。
             */
            copied: string;

            /**
             * source・editor・closed操作のラベルとして表示するローカライズ済み文言。
             */
            sourceEditorClosed: string;

            /**
             * 表示項目「document・changed」の文言として表示するローカライズ済み文言。
             */
            documentChanged: string;

            /**
             * 表示項目「resize・column」の文言として表示するローカライズ済み文言。
             */
            resizeColumn: string;

            /**
             * 表示項目「resize・row」の文言として表示するローカライズ済み文言。
             */
            resizeRow: string;

            /**
             * resize・editor設定の表示文言として表示するローカライズ済み文言。
             */
            resizeEditor: string;

            /**
             * 適用前の変更がある状態を示すラベル。
             */
            modified: string;
            /**
             * 適用前の変更を破棄する確認文。
             */
            discard: string;
            /**
             * 現在の選択範囲を示すラベル。
             */
            selection: string;
            /**
             * 選択範囲のセル数を表す語。
             */
            cells: string;
            /**
             * 表全体を選択する操作のラベル。
             */
            selectAll: string;
            /**
             * 行のドラッグ並べ替え操作の説明。
             */
            dragRow: string;
            /**
             * 列のドラッグ並べ替え操作の説明。
             */
            dragColumn: string;
            /**
             * 現在の行を上へ移動する操作のラベル。
             */
            moveRowUp: string;
            /**
             * 現在の行を下へ移動する操作のラベル。
             */
            moveRowDown: string;
            /**
             * 現在の列を左へ移動する操作のラベル。
             */
            moveColumnLeft: string;
            /**
             * 現在の列を右へ移動する操作のラベル。
             */
            moveColumnRight: string;
            /**
             * 列を昇順に並べ替える操作のラベル。
             */
            sortAscending: string;
            /**
             * 列を降順に並べ替える操作のラベル。
             */
            sortDescending: string;
        };

        /**
         * 表示文言のhelpに関する状態または設定。
         */
        help: {

            /**
             * 表示項目「shortcuts」の文言として表示するローカライズ済み文言。
             */
            shortcuts: string;

            /**
             * 表示項目「markdown」の文言として表示するローカライズ済み文言。
             */
            markdown: string;

            /**
             * 画面または設定項目の説明として表示するローカライズ済み文言。
             */
            about: string;

            /**
             * shortcut・image書式コマンドのラベルとして表示するローカライズ済み文言。
             */
            shortcutImage: string;

            /**
             * 表示項目「shortcut・table・break」の文言として表示するローカライズ済み文言。
             */
            shortcutTableBreak: string;

            /**
             * 表示項目「markdown・intro」の文言として表示するローカライズ済み文言。
             */
            markdownIntro: string;

            /**
             * 表示項目「markdown・features」の文言として表示するローカライズ済み文言。
             */
            markdownFeatures: string;

            /**
             * 画面または設定項目の説明として表示するローカライズ済み文言。
             */
            aboutIntro: string;

            /**
             * 画面または設定項目の説明として表示するローカライズ済み文言。
             */
            aboutFeatures: string;
        };

        /**
         * 表示文言のtoastを処理し、呼び出し側へ結果または副作用を返す。
         * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
         * @returns 表示文言で利用する文字列。
         */
        toast: {
            /**
             * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            imagesSaved: (count: number) => string;
            /**
             * 表示文言のpdf・resource・warningsを処理し、呼び出し側へ結果または副作用を返す。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            pdfResourceWarnings: (count: number, detail: string) => string;
            /**
             * 表示文言のpreflight・summaryを処理し、呼び出し側へ結果または副作用を返す。
             * @param errors - 表示文言で発生した例外または失敗理由。
             * @param warnings - 表示文言で扱う数値。
             * @param infos - 表示文言で扱う数値。
             * @returns 表示文言で利用する文字列。
             */
            preflightSummary: (errors: number, warnings: number, infos: number) => string;
            /**
             * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            imageSaveFailed: (detail: string) => string;
            /**
             * 表示文言のpdf・export・failedを処理し、呼び出し側へ結果または副作用を返す。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            pdfExportFailed: (detail: string) => string;
            /**
             * 表示文言のresource・check・failedを処理し、呼び出し側へ結果または副作用を返す。
             * @param detail - 表示文言で受け渡す文字列。
             * @param duringPdf - 表示文言で読み書きするリソースの場所。
             * @returns 表示文言で利用する文字列。
             */
            resourceCheckFailed: (detail: string, duringPdf: boolean) => string;
            /**
             * 表示文言のoperation・failedを処理し、呼び出し側へ結果または副作用を返す。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            operationFailed: (detail: string) => string;
            /**
             * 表示文言のpdf・exportedを処理し、呼び出し側へ結果または副作用を返す。
             * @param path - 読み書きするファイルまたはリソースの場所。
             * @returns 表示文言で利用する文字列。
             */
            pdfExported: (path: string) => string;
            /**
             * 表示文言のhtml・exportedを処理し、呼び出し側へ結果または副作用を返す。
             * @param path - 読み書きするファイルまたはリソースの場所。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            htmlExported: (path: string, count: number) => string;
            /**
             * 表示文言のhtml・export・failedを処理し、呼び出し側へ結果または副作用を返す。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            htmlExportFailed: (detail: string) => string;

            /**
             * 表示項目「table・cell・required」の文言として表示するローカライズ済み文言。
             */
            tableCellRequired: string;

            /**
             * cannot・paste・tsv操作のラベルとして表示するローカライズ済み文言。
             */
            cannotPasteTsv: string;

            /**
             * 表示項目「table・copied」の文言として表示するローカライズ済み文言。
             */
            tableCopied: string;
            /**
             * 表示文言の条件を判定する。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 条件が成立したかを示す真偽値。
             */
            cannotCopyTsv: (detail?: string) => string;

            /**
             * 表示項目「workspace・trust・required」の文言として表示するローカライズ済み文言。
             */
            workspaceTrustRequired: string;
            /**
             * 表示文言のpdf・started・with・diagnosticsを処理し、呼び出し側へ結果または副作用を返す。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            pdfStartedWithDiagnostics: (count: number, detail: string) => string;
            /**
             * 表示文言のpdf・fallback・to・markdownを処理し、呼び出し側へ結果または副作用を返す。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言で利用する文字列。
             */
            pdfFallbackToMarkdown: (detail?: string) => string;
        };

        /**
         * 表示文言のerrorsに関する状態または設定。
         */
        errors: {

            /**
             * 表示項目「ack・mismatch」の文言として表示するローカライズ済み文言。
             */
            ackMismatch: string;
            /**
             * 表示文言のpending・operation・chainを処理し、呼び出し側へ結果または副作用を返す。
             * @param opId - 表示文言の対象や分岐を識別する値。
             * @returns 表示文言で利用する文字列。
             */
            pendingOperationChain: (opId: string) => string;

            /**
             * 表示項目「clipboard・unavailable」の文言として表示するローカライズ済み文言。
             */
            clipboardUnavailable: string;

            /**
             * 表示項目「bmp・conversion」の文言として表示するローカライズ済み文言。
             */
            bmpConversion: string;
            /**
             * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
             * @param maxSizeMb - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言で利用する文字列。
             */
            imageSize: (maxSizeMb: number) => string;
        };
    };

    /**
     * 表示文言のrendererに関する状態または設定。
     */
    renderer: {

        /**
         * remote・image・disabled書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        remoteImageDisabled: string;

        /**
         * コピー操作のラベルとして表示するローカライズ済み文言。
         */
        copy: string;

        /**
         * 表示項目「copied」の文言として表示するローカライズ済み文言。
         */
        copied: string;

        /**
         * 表示項目「page・break」の文言として表示するローカライズ済み文言。
         */
        pageBreak: string;

        /**
         * 表示項目「toc」の文言として表示するローカライズ済み文言。
         */
        toc: string;

        /**
         * 表示項目「back・to・text」の文言として表示するローカライズ済み文言。
         */
        backToText: string;

        /**
         * 失敗または入力エラーの説明として表示するローカライズ済み文言。
         */
        mathError: string;

        /**
         * 失敗または入力エラーの説明として表示するローカライズ済み文言。
         */
        mermaidError: string;

        /**
         * Mermaid図のアクセシブル名。
         */
        mermaidDiagramLabel: (description: string) => string;

        /**
         * 表示文言のalertsに関する状態または設定。
         */
        alerts: {
            /**
             * 表示項目「note」の文言として表示するローカライズ済み文言。
             */
            note: string;
            /**
             * 表示項目「tip」の文言として表示するローカライズ済み文言。
             */
            tip: string;
            /**
             * 表示項目「important」の文言として表示するローカライズ済み文言。
             */
            important: string;
            /**
             * 失敗または入力エラーの説明として表示するローカライズ済み文言。
             */
            warning: string;
            /**
             * 表示項目「caution」の文言として表示するローカライズ済み文言。
             */
            caution: string
        };
    };

    /**
     * 表示文言のdiagnosticsを処理し、呼び出し側へ結果または副作用を返す。
     * @param marker - 表示文言で受け渡す文字列。
     * @returns 表示文言で利用する文字列。
     */
    diagnostics: {
        /**
         * 表示文言のunclosed・fenceを処理し、呼び出し側へ結果または副作用を返す。
         * @param marker - 表示文言で受け渡す文字列。
         * @returns 表示文言で利用する文字列。
         */
        unclosedFence: (marker: string) => string;
        /**
         * 表示文言のduplicate・headingを処理し、呼び出し側へ結果または副作用を返す。
         * @param id - 表示文言の対象や分岐を識別する値。
         * @returns 表示文言で利用する文字列。
         */
        duplicateHeading: (id: string) => string;

        /**
         * 失敗または入力エラーの説明として表示するローカライズ済み文言。
         */
        invalidTableSeparator: string;

        /**
         * empty・image・alt書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        emptyImageAlt: string;
        /**
         * 表示文言のlocal・image・checkを処理し、呼び出し側へ結果または副作用を返す。
         * @param source - 解析・描画・変換の起点となる本文。
         * @returns 表示文言で利用する文字列。
         */
        localImageCheck: (source: string) => string;

        /**
         * 表示項目「empty・table・header」の文言として表示するローカライズ済み文言。
         */
        emptyTableHeader: string;
        /**
         * 表示文言のtable・column・mismatchを処理し、呼び出し側へ結果または副作用を返す。
         * @param header - 表示文言で扱う数値。
         * @param separator - 表示文言で扱う数値。
         * @param kind - メッセージ、項目、または処理の種類を識別する値。
         * @returns 表示文言で利用する文字列。
         */
        tableColumnMismatch: (header: number, separator: number, kind: 'separator' | 'body') => string;
        /**
         * 表示文言のmissing・referenceを処理し、呼び出し側へ結果または副作用を返す。
         * @param label - 画面または検証結果に表示する説明文。
         * @returns 表示文言で利用する文字列。
         */
        missingReference: (label: string) => string;
        /**
         * 表示文言のlocal・resourceを処理し、呼び出し側へ結果または副作用を返す。
         * @param kind - メッセージ、項目、または処理の種類を識別する値。
         * @param missing - 表示文言の条件を示すフラグ。
         * @param source - 解析・描画・変換の起点となる本文。
         * @param detail - 表示文言で受け渡す文字列。
         * @returns 表示文言で利用する文字列。
         */
        localResource: (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => string;
    };

    /**
     * 表示文言のhostに関する状態または設定。
     */
    host: {

        /**
         * 表示項目「pdf・trust・required」の文言として表示するローカライズ済み文言。
         */
        pdfTrustRequired: string;

        /**
         * 表示項目「pdf・progress」の文言として表示するローカライズ済み文言。
         */
        pdfProgress: string;
        /**
         * 表示文言のpdf・exportedを処理し、呼び出し側へ結果または副作用を返す。
         * @param path - 読み書きするファイルまたはリソースの場所。
         * @returns 表示文言で利用する文字列。
         */
        pdfExported: (path: string) => string;

        /**
         * 表示項目「html・trust・required」の文言として表示するローカライズ済み文言。
         */
        htmlTrustRequired: string;

        /**
         * 表示項目「html・progress」の文言として表示するローカライズ済み文言。
         */
        htmlProgress: string;
        /**
         * 表示文言のhtml・exportedを処理し、呼び出し側へ結果または副作用を返す。
         * @param path - 読み書きするファイルまたはリソースの場所。
         * @returns 表示文言で利用する文字列。
         */
        htmlExported: (path: string) => string;

        /**
         * 表示項目「html・render・timeout」の文言として表示するローカライズ済み文言。
         */
        htmlRenderTimeout: string;

        /**
         * 開く操作のラベルとして表示するローカライズ済み文言。
         */
        open: string;

        /**
         * save・canceled操作のラベルとして表示するローカライズ済み文言。
         */
        saveCanceled: string;

        /**
         * image・document・must・be・saved操作のラベルとして表示するローカライズ済み文言。
         */
        imageDocumentMustBeSaved: string;
        /**
         * 表示文言のunsupported・imageを処理し、呼び出し側へ結果または副作用を返す。
         * @param mime - 画像または出力データのMIMEタイプ。
         * @returns 表示文言で利用する文字列。
         */
        unsupportedImage: (mime: string) => string;

        /**
         * 失敗または入力エラーの説明として表示するローカライズ済み文言。
         */
        invalidImageDirectory: string;

        /**
         * 表示項目「pdf・browser・unavailable」の文言として表示するローカライズ済み文言。
         */
        pdfBrowserUnavailable: string;

        /**
         * 失敗または入力エラーの説明として表示するローカライズ済み文言。
         */
        errorPrefix: string;

        /**
         * 表示項目「client・id・mismatch」の文言として表示するローカライズ済み文言。
         */
        clientIdMismatch: string;
    };

    /**
     * 表示文言のeditorに関する状態または設定。
     */
    editor: {
        /**
         * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
         */
        placeholder: string;
        /**
         * 入力欄のプレースホルダーとして表示するローカライズ済み文言。
         */
        codePlaceholder: string;
        /**
         * default・link・label書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        defaultLinkLabel: string;
        /**
         * default・image・alt書式コマンドのラベルとして表示するローカライズ済み文言。
         */
        defaultImageAlt: string;
        /**
         * 表示項目「plain・text」の文言として表示するローカライズ済み文言。
         */
        plainText: string
    };

    /**
     * 表示文言のinternalに関する状態または設定。
     */
    internal: {
        /**
         * 表示項目「concurrent・edits・overlap」の文言として表示するローカライズ済み文言。
         */
        concurrentEditsOverlap: string;
        /**
         * 表示項目「root・not・found」の文言として表示するローカライズ済み文言。
         */
        rootNotFound: string
    };
}

/**
 * 表示文言で扱う値の種類と境界を表す型。
 */
type RawCatalog = Record<string, unknown>;
/**
 * 表示文言で扱う値の種類と境界を表す型。
 */
type RawLocales = Record<SupportedLanguage, RawCatalog>;
/**
 * 表示文言で扱う値の種類と境界を表す型。
 */
type Values = Record<string, string | number>;


/**
 * 表示文言で扱う一覧または対応表。
 */
const rawLocales = localeCatalog as RawLocales;

/**
 * 表示文言の入力を許可された形式へ整える。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 表示文言で利用する文字列。
 */
function normalizeLanguage(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/_/g, '-');
}

/**
 * 表示文言のlanguage・from・localeを処理し、呼び出し側へ結果または副作用を返す。
 * @param value - 検証・変換・保存の対象となる値。
 * @returns 副作用を完了し、値は返さない。
 */
function languageFromLocale(value: string | undefined): SupportedLanguage | undefined {
    const normalized = normalizeLanguage(value);
    if (!normalized) return undefined;
    if (normalized === 'zh' || normalized.startsWith('zh-cn')) return 'zh-cn';
    const primary = normalized.split('-')[0];
    return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? primary as SupportedLanguage : undefined;
}

/**
 * 設定値と利用可能な辞書から表示言語を決める。
 * @param setting - 表示文言へ渡す設定または境界値。
 * @param vscodeLanguage - 表示文言の対象や分岐を識別する値。
 * @returns 表示文言のresolve・languageが生成する結果。
 */
export function resolveLanguage(setting: string | undefined, vscodeLanguage?: string): SupportedLanguage {
    const normalized = normalizeLanguage(setting);
    if (normalized && normalized !== 'auto') return languageFromLocale(normalized) ?? 'en';
    return languageFromLocale(vscodeLanguage) ?? 'en';
}

/**
 * 表示文言から必要な値またはリソースを取得する。
 * @param language - 表示文言の対象や分岐を識別する値。
 * @returns 表示文言のresolve・catalogが生成する結果。
 */
function resolveCatalog(language: SupportedLanguage): RawCatalog {
    return rawLocales[language];
}

/**
 * 表示文言から必要な値またはリソースを取得する。
 * @param catalog - 表示文言へ渡す入力。
 * @param key - 表示文言の対象や分岐を識別する値。
 * @returns 表示文言で利用する文字列。
 */
function read(catalog: RawCatalog, key: string): string {
    let value: unknown = catalog;
    for (const segment of key.split('.')) {
        if (!value || typeof value !== 'object') return '';
        value = (value as Record<string, unknown>)[segment];
    }
    return typeof value === 'string' ? value : '';
}

/**
 * 表示文言のinterpolateを処理し、呼び出し側へ結果または副作用を返す。
 * @param template - 表示文言で受け渡す文字列。
 * @param values - 表示文言へ渡す入力。
 * @returns 表示文言で利用する文字列。
 */
function interpolate(template: string, values: Values = {}): string {
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,
        /**
         * matchをcallへ渡し、表示文言の結果または副作用を処理する。
         * @param match - 表示文言へ渡す入力。
         * @param key - 表示文言の対象や分岐を識別する値。
         * @returns 表示文言のコールバックが生成する結果。
         */
        (match, key: string) => (
            Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
        ));
}

/**
 * 表示文言で使う値または実行環境を組み立てる。
 * @param language - 表示文言の対象や分岐を識別する値。
 * @returns 表示文言で生成または変換した値。
 */
function createMessages(language: SupportedLanguage): Messages {
    const raw = resolveCatalog(language) as Record<string, any>;


    const text = /**
     * 表示文言のtextを処理し、呼び出し側へ結果または副作用を返す。
     * @param key - 表示文言の対象や分岐を識別する値。
     * @param values - 表示文言へ渡す入力。
     * @returns 表示文言で利用する文字列。
     */ (key: string, values?: Values): string => interpolate(read(raw, key), values);
    return {
        ribbon: {
            tabs: raw.ribbon.tabs,
            label: raw.ribbon.label,
            source: raw.ribbon.source,
            sourceTitle: raw.ribbon.sourceTitle,
            outline: raw.ribbon.outline,
            outlineTitle: raw.ribbon.outlineTitle,
            scrollSync: raw.ribbon.scrollSync,
            scrollSyncTitle: raw.ribbon.scrollSyncTitle,
            search: raw.ribbon.search,
            split: raw.ribbon.split,
            textOnly: raw.ribbon.textOnly,
            previewOnly: raw.ribbon.previewOnly,
            pin: raw.ribbon.pin,
            unpin: raw.ribbon.unpin,
            collapse: raw.ribbon.collapse,
            expand: raw.ribbon.expand,
            groups: raw.ribbon.groups,
            labels: {
                ...raw.ribbon.labels,


                heading: /**
                 * 表示文言のheadingを処理し、呼び出し側へ結果または副作用を返す。
                 * @param level - 表示文言で扱う数値。
                 * @returns 表示文言のheadingが生成する結果。
                 */ (level: number) => text('ribbon.labels.heading', { level }),
                exportHtml: raw.ribbon.labels.exportHtml,
                embedImages: raw.ribbon.labels.embedImages,
                convertLinkedMarkdown: raw.ribbon.labels.convertLinkedMarkdown,
                saveWithoutDialog: raw.ribbon.labels.saveWithoutDialog
            },
            featureDescriptions: raw.ribbon.labels.featureDescriptions,
            codeLanguages: raw.ribbon.codeLanguages,
            snippets: raw.ribbon.snippets,
            settings: {
                ...raw.ribbon.settings,
            }
        },
        app: {
            startup: raw.app.startup,
            outline: raw.app.outline,
            hideOutline: raw.app.hideOutline,
            showOutline: raw.app.showOutline,
            outlineWidth: raw.app.outlineWidth,
            noHeadings: raw.app.noHeadings,
            searchAndReplace: raw.app.searchAndReplace,
            searchText: raw.app.searchText,
            replacementText: raw.app.replacementText,
            replacement: raw.app.replacement,
            previousMatch: raw.app.previousMatch,
            nextMatch: raw.app.nextMatch,
            replaceAll: raw.app.replaceAll,
            close: raw.app.close,
            splitBoundary: raw.app.splitBoundary,
            selectionFormatting: raw.app.selectionFormatting,
            diagnosticsTitle: raw.app.diagnosticsTitle,
            diagnosticHelp: raw.app.diagnosticHelp,
            noProblems: raw.app.noProblems,
            severity: raw.app.severity,


            line: /**
             * 表示文言のlineを処理し、呼び出し側へ結果または副作用を返す。
             * @param line - 表示文言の位置・寸法・件数・時間を表す数値。
             * @returns 表示文言のlineが生成する結果。
             */ (line: number) => text('app.line', { line }),
            printSettings: raw.app.printSettings,
            printSettingsHelp: raw.app.printSettingsHelp,
            paper: raw.app.paper,
            orientation: raw.app.orientation,
            portrait: raw.app.portrait,
            landscape: raw.app.landscape,
            header: raw.app.header,
            footer: raw.app.footer,
            margins: raw.app.margins,
            top: raw.app.top,
            right: raw.app.right,
            bottom: raw.app.bottom,
            left: raw.app.left,
            withoutDialog: raw.app.withoutDialog,
            typography: raw.app.typography,
            fontFamily: raw.app.fontFamily,
            bodyFontSize: raw.app.bodyFontSize,
            headingFontSizes: raw.app.headingFontSizes,
            codeFontSize: raw.app.codeFontSize,
            lineHeight: raw.app.lineHeight,
            paragraphSpacing: raw.app.paragraphSpacing,
            status: {
                modeSplit: raw.app.status.modeSplit,
                modePreview: raw.app.status.modePreview,


                lines: /**
                 * 表示文言のlinesを処理し、呼び出し側へ結果または副作用を返す。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言のlinesが生成する結果。
                 */ (count: number) => text('app.status.lines', { count }),


                textCharacters: /**
                 * 表示文言のtext・charactersを処理し、呼び出し側へ結果または副作用を返す。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言のtext・charactersが生成する結果。
                 */ (count: number) => text('app.status.textCharacters', { count }),


                markdownCharacters: /**
                 * 表示文言の変更または利用者の操作意図を記録し、後続処理へ渡す。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言のmarkdown・charactersが生成する結果。
                 */ (count: number) => text('app.status.markdownCharacters', { count }),


                zoom: /**
                 * 表示文言のzoomを処理し、呼び出し側へ結果または副作用を返す。
                 * @param percent - 表示文言で扱う数値。
                 * @returns 表示文言のzoomが生成する結果。
                 */ (percent: number) => text('app.status.zoom', { percent }),
                syncing: raw.app.status.syncing,
                synced: raw.app.status.synced
            },
            inspector: raw.app.inspector,
            link: raw.app.link,
            previewImageContextMenu: raw.app.previewImageContextMenu,
            textColor: raw.app.textColor,
            imageControls: raw.app.imageControls,
            pdfPreview: {
                zoomOut: raw.app.pdfPreview.zoomOut,
                zoomIn: raw.app.pdfPreview.zoomIn,
                unavailable: raw.app.pdfPreview.unavailable,
                generating: raw.app.pdfPreview.generating,
                drawing: raw.app.pdfPreview.drawing,
                preparing: raw.app.pdfPreview.preparing,
                loading: raw.app.pdfPreview.loading,
                webviewUnavailable: raw.app.pdfPreview.webviewUnavailable,
                failed: (detail: string) => text('app.pdfPreview.failed', { detail }),
                pageError: raw.app.pdfPreview.pageError,
                pageLabel: (page: number) => text('app.pdfPreview.pageLabel', { page })
            },
            tableEditor: {
                title: raw.app.tableEditor.title,
                close: raw.app.tableEditor.close,
                addRow: raw.app.tableEditor.addRow,
                deleteRow: raw.app.tableEditor.deleteRow,
                addColumn: raw.app.tableEditor.addColumn,
                deleteColumn: raw.app.tableEditor.deleteColumn,
                alignLeft: raw.app.tableEditor.alignLeft,
                alignCenter: raw.app.tableEditor.alignCenter,
                alignRight: raw.app.tableEditor.alignRight,
                clearAlignment: raw.app.tableEditor.clearAlignment,
                copyTsv: raw.app.tableEditor.copyTsv,
                copyColumn: raw.app.tableEditor.copyColumn,
                copyRow: raw.app.tableEditor.copyRow,
                cancel: raw.app.tableEditor.cancel,
                apply: raw.app.tableEditor.apply,
                navigationHint: raw.app.tableEditor.navigationHint,
                sourceEditorRequired: raw.app.tableEditor.sourceEditorRequired,
                tableRequired: raw.app.tableEditor.tableRequired,


                rowColumnLimit: /**
                 * 表示文言のrow・column・limitを処理し、呼び出し側へ結果または副作用を返す。
                 * @param rows - 表示文言で走査または更新する要素。
                 * @param columns - 表示文言で走査または更新する要素。
                 * @returns 表示文言のrow・column・limitが生成する結果。
                 */ (rows: number, columns: number) => text('app.tableEditor.rowColumnLimit', { rows, columns }),
                copied: raw.app.tableEditor.copied,
                sourceEditorClosed: raw.app.tableEditor.sourceEditorClosed,
                documentChanged: raw.app.tableEditor.documentChanged,
                resizeColumn: raw.app.tableEditor.resizeColumn,
                resizeRow: raw.app.tableEditor.resizeRow,
                resizeEditor: raw.app.tableEditor.resizeEditor,
                modified: raw.app.tableEditor.modified,
                discard: raw.app.tableEditor.discard,
                selection: raw.app.tableEditor.selection,
                cells: raw.app.tableEditor.cells,
                selectAll: raw.app.tableEditor.selectAll,
                dragRow: raw.app.tableEditor.dragRow,
                dragColumn: raw.app.tableEditor.dragColumn,
                moveRowUp: raw.app.tableEditor.moveRowUp,
                moveRowDown: raw.app.tableEditor.moveRowDown,
                moveColumnLeft: raw.app.tableEditor.moveColumnLeft,
                moveColumnRight: raw.app.tableEditor.moveColumnRight,
                sortAscending: raw.app.tableEditor.sortAscending,
                sortDescending: raw.app.tableEditor.sortDescending
            },
            help: raw.app.help,
            toast: {


                imagesSaved: /**
                 * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言のimages・savedが生成する結果。
                 */ (count: number) => text('app.toast.imagesSaved', { count }),


                pdfResourceWarnings: /**
                 * 表示文言のpdf・resource・warningsを処理し、呼び出し側へ結果または副作用を返す。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のpdf・resource・warningsが生成する結果。
                 */ (count: number, detail: string) => text('app.toast.pdfResourceWarnings', { count, detail }),


                preflightSummary: /**
                 * 表示文言のpreflight・summaryを処理し、呼び出し側へ結果または副作用を返す。
                 * @param errors - 表示文言で発生した例外または失敗理由。
                 * @param warnings - 表示文言で扱う数値。
                 * @param infos - 表示文言で扱う数値。
                 * @returns 表示文言のpreflight・summaryが生成する結果。
                 */ (errors: number, warnings: number, infos: number) => text('app.toast.preflightSummary', { errors, warnings, infos }),


                imageSaveFailed: /**
                 * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のimage・save・failedが生成する結果。
                 */ (detail: string) => text('app.toast.imageSaveFailed', { detail }),


                pdfExportFailed: /**
                 * 表示文言のpdf・export・failedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のpdf・export・failedが生成する結果。
                 */ (detail: string) => text('app.toast.pdfExportFailed', { detail }),


                resourceCheckFailed: /**
                 * 表示文言のresource・check・failedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @param duringPdf - 表示文言で読み書きするリソースの場所。
                 * @returns 表示文言のresource・check・failedが生成する結果。
                 */ (detail: string, duringPdf: boolean) => text('app.toast.resourceCheckFailed', { prefix: duringPdf ? `${raw.host.pdfProgress} ` : '', detail }),


                operationFailed: /**
                 * 表示文言のoperation・failedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のoperation・failedが生成する結果。
                 */ (detail: string) => text('app.toast.operationFailed', { detail }),


                pdfExported: /**
                 * 表示文言のpdf・exportedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param path - 読み書きするファイルまたはリソースの場所。
                 * @returns 表示文言のpdf・exportedが生成する結果。
                 */ (path: string) => text('app.toast.pdfExported', { path }),


                htmlExported: /**
                 * 表示文言のhtml・exportedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param path - 読み書きするファイルまたはリソースの場所。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言で利用する文字列。
                 */ (path: string, count: number) => text('app.toast.htmlExported', { path, count }),


                htmlExportFailed: /**
                 * 表示文言のhtml・export・failedを処理し、呼び出し側へ結果または副作用を返す。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言で利用する文字列。
                 */ (detail: string) => text('app.toast.htmlExportFailed', { detail }),
                tableCellRequired: raw.app.toast.tableCellRequired,
                cannotPasteTsv: raw.app.toast.cannotPasteTsv,
                tableCopied: raw.app.toast.tableCopied,


                cannotCopyTsv: /**
                 * 表示文言の条件を判定する。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 条件が成立したかを示す真偽値。
                 */ (detail?: string) => detail ? text('app.toast.cannotCopyTsv', { detail }) : raw.app.toast.cannotCopyTsvEmpty,
                workspaceTrustRequired: raw.app.toast.workspaceTrustRequired,


                pdfStartedWithDiagnostics: /**
                 * 表示文言のpdf・started・with・diagnosticsを処理し、呼び出し側へ結果または副作用を返す。
                 * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のpdf・started・with・diagnosticsが生成する結果。
                 */ (count: number, detail: string) => text('app.toast.pdfStartedWithDiagnostics', { count, detail }),


                pdfFallbackToMarkdown: /**
                 * 表示文言のpdf・fallback・to・markdownを処理し、呼び出し側へ結果または副作用を返す。
                 * @param detail - 表示文言で受け渡す文字列。
                 * @returns 表示文言のpdf・fallback・to・markdownが生成する結果。
                 */ (detail?: string) => text('app.toast.pdfFallbackToMarkdown', { prefix: detail ? `${detail} ` : '' })
            },
            errors: {
                ackMismatch: raw.app.errors.ackMismatch,


                pendingOperationChain: /**
                 * 表示文言のpending・operation・chainを処理し、呼び出し側へ結果または副作用を返す。
                 * @param opId - 表示文言の対象や分岐を識別する値。
                 * @returns 表示文言のpending・operation・chainが生成する結果。
                 */ (opId: string) => text('app.errors.pendingOperationChain', { opId }),
                clipboardUnavailable: raw.app.errors.clipboardUnavailable,
                bmpConversion: raw.app.errors.bmpConversion,


                imageSize: /**
                 * 表示文言の入力を検証し、表示または保存に使う形式へ変換する。
                 * @param maxSizeMb - 表示文言の位置・寸法・件数・時間を表す数値。
                 * @returns 表示文言のimage・sizeが生成する結果。
                 */ (maxSizeMb: number) => text('app.errors.imageSize', { maxSizeMb })
            }
        },
        renderer: {
            ...raw.renderer,
            mermaidDiagramLabel: (description: string) => text('renderer.mermaidDiagramLabel', { description })
        },
        diagnostics: {


            unclosedFence: /**
             * 表示文言のunclosed・fenceを処理し、呼び出し側へ結果または副作用を返す。
             * @param marker - 表示文言で受け渡す文字列。
             * @returns 表示文言のunclosed・fenceが生成する結果。
             */ (marker: string) => text('diagnostics.unclosedFence', { marker }),


            duplicateHeading: /**
             * 表示文言のduplicate・headingを処理し、呼び出し側へ結果または副作用を返す。
             * @param id - 表示文言の対象や分岐を識別する値。
             * @returns 表示文言のduplicate・headingが生成する結果。
             */ (id: string) => text('diagnostics.duplicateHeading', { id }),
            invalidTableSeparator: raw.diagnostics.invalidTableSeparator,
            emptyImageAlt: raw.diagnostics.emptyImageAlt,


            localImageCheck: /**
             * 表示文言のlocal・image・checkを処理し、呼び出し側へ結果または副作用を返す。
             * @param source - 解析・描画・変換の起点となる本文。
             * @returns 表示文言のlocal・image・checkが生成する結果。
             */ (source: string) => text('diagnostics.localImageCheck', { source }),
            emptyTableHeader: raw.diagnostics.emptyTableHeader,


            tableColumnMismatch: /**
             * 表示文言のtable・column・mismatchを処理し、呼び出し側へ結果または副作用を返す。
             * @param header - 表示文言で扱う数値。
             * @param count - 表示文言の位置・寸法・件数・時間を表す数値。
             * @param kind - メッセージ、項目、または処理の種類を識別する値。
             * @returns 表示文言のtable・column・mismatchが生成する結果。
             */ (header: number, count: number, kind: 'separator' | 'body') => text('diagnostics.tableColumnMismatch', { header, count, kind: raw.diagnostics.tableKind[kind] }),


            missingReference: /**
             * 表示文言のmissing・referenceを処理し、呼び出し側へ結果または副作用を返す。
             * @param label - 画面または検証結果に表示する説明文。
             * @returns 表示文言のmissing・referenceが生成する結果。
             */ (label: string) => text('diagnostics.missingReference', { label }),


            localResource: /**
             * 表示文言のlocal・resourceを処理し、呼び出し側へ結果または副作用を返す。
             * @param kind - メッセージ、項目、または処理の種類を識別する値。
             * @param missing - 表示文言の条件を示すフラグ。
             * @param source - 解析・描画・変換の起点となる本文。
             * @param detail - 表示文言で受け渡す文字列。
             * @returns 表示文言のlocal・resourceが生成する結果。
             */ (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => {
                    const suffix = kind === 'image' ? (missing ? 'imageMissing' : 'imageCheckFailed') : (missing ? 'linkMissing' : 'linkCheckFailed');
                    return text(`diagnostics.localResource.${suffix}`, { source, detail });
                }
        },
        host: {
            pdfTrustRequired: raw.host.pdfTrustRequired,
            pdfProgress: raw.host.pdfProgress,


            pdfExported: /**
             * 表示文言のpdf・exportedを処理し、呼び出し側へ結果または副作用を返す。
             * @param path - 読み書きするファイルまたはリソースの場所。
             * @returns 表示文言のpdf・exportedが生成する結果。
             */ (path: string) => text('host.pdfExported', { path }),
            htmlTrustRequired: raw.host.htmlTrustRequired,
            htmlProgress: raw.host.htmlProgress,


            htmlExported: /**
             * 表示文言のhtml・exportedを処理し、呼び出し側へ結果または副作用を返す。
             * @param path - 読み書きするファイルまたはリソースの場所。
             * @returns 表示文言のhtml・exportedが生成する結果。
             */ (path: string) => text('host.htmlExported', { path }),
            htmlRenderTimeout: raw.host.htmlRenderTimeout,
            open: raw.host.open,
            saveCanceled: raw.host.saveCanceled,
            imageDocumentMustBeSaved: raw.host.imageDocumentMustBeSaved,


            unsupportedImage: /**
             * 表示文言のunsupported・imageを処理し、呼び出し側へ結果または副作用を返す。
             * @param mime - 画像または出力データのMIMEタイプ。
             * @returns 表示文言のunsupported・imageが生成する結果。
             */ (mime: string) => text('host.unsupportedImage', { mime }),
            invalidImageDirectory: raw.host.invalidImageDirectory,
            pdfBrowserUnavailable: raw.host.pdfBrowserUnavailable,
            errorPrefix: raw.host.errorPrefix,
            clientIdMismatch: raw.host.clientIdMismatch
        },
        editor: raw.editor,
        internal: raw.internal
    };
}

/**
 * 選択した言語のローカライズ辞書を読み込み、未登録キーをフォールバックで補う。
 * @param language - 表示文言の対象や分岐を識別する値。
 * @param vscodeLanguage - 表示文言の対象や分岐を識別する値。
 * @returns 表示文言のget・messagesが生成する結果。
 */
export function getMessages(language: SupportedLanguage | string | undefined, vscodeLanguage?: string): Messages {
    return MESSAGE_CATALOG[resolveLanguage(language, vscodeLanguage)];
}


/**
 * 表示文言のmessage・catalogに関する状態または設定。
 */
export const MESSAGE_CATALOG: Record<SupportedLanguage, Messages> = Object.fromEntries(
    SUPPORTED_LANGUAGES.map(
        /**
         * 各languageをcreate・messagesへ渡し、変換結果を一覧化する。
         * @param language - 表示文言の対象や分岐を識別する値。
         * @returns 入力要素から生成した変換結果の一覧。
         */
        (language) => [language, createMessages(language)])
) as Record<SupportedLanguage, Messages>;
