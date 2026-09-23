/**
 * @file messages.ts
 * 実行境界: Extension HostとWebviewの共有層。
 * 責務: 両実行境界で共有する値、プロトコル、変換を扱う。
 * 入出力: 呼び出し側の入力を検証・変換し、型またはテストで定義された結果を返す。
 * 副作用: 呼び出し元から渡された値を変換し、外部状態を直接変更しない。
 * 不変条件: 既存のデータ形式と呼び出し側の契約を維持する。
 */
/**
 * UIとユーザー向けメッセージの型・組み立て処理。
 * 文言本体は同階層の locales.json に置き、このファイルには埋め込まない。
 */
import localeCatalog from './locales.json';

/** 「SUPPORTED_LANGUAGES」は、関連する処理間で共有する設定値または状態です。 */
/** ロケール正規化とメッセージカタログが受け付ける言語識別子。 */
export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh-cn', 'ko', 'fr', 'de', 'es'] as const;
/**
 * 「SupportedLanguage」として扱う値の型を定義します。
 */
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
/**
 * 「LanguageSetting」として扱う値の型を定義します。
 */
export type LanguageSetting = 'auto' | SupportedLanguage;

/**
 * 「Messages」が満たすデータ契約を定義します。
 */
export interface Messages {

    /**
     * 「ribbon」は、言語別メッセージまたは表示用データの一項目です。
     */
    ribbon: {

        /**
         * 「tabs」は、言語別メッセージまたは表示用データの一項目です。
         */
        tabs: {
        /**
         * 「home」は、対象の内容または識別子を表す文字列です。
         */
        home: string;
        /**
         * 「insert」は、対象の内容または識別子を表す文字列です。
         */
        insert: string;
        /**
         * 「table」は、対象の内容または識別子を表す文字列です。
         */
        table: string;
        /**
         * 「view」は、画面の表示モードまたは現在のUI状態を示します。
         */
        view: string;
        /**
         * 「export」は、対象の内容または識別子を表す文字列です。
         */
        export: string;
        /**
         * 「settings」は、利用側が共有する設定または現在状態を保持します。
         */
        settings: string;
        /**
         * 「help」は、対象の内容または識別子を表す文字列です。
         */
        help: string };

        /**
         * 「label」は、画面または通知へ表示する文言を保持します。
         */
        label: string;

        /**
         * 「source」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
         */
        source: string;

        /**
         * 「sourceTitle」は、画面または通知へ表示する文言を保持します。
         */
        sourceTitle: string;

        /**
         * 「outline」は、対象の内容または識別子を表す文字列です。
         */
        outline: string;

        /**
         * 「outlineTitle」は、画面または通知へ表示する文言を保持します。
         */
        outlineTitle: string;

        /**
         * 「scrollSync」は、対象の内容または識別子を表す文字列です。
         */
        scrollSync: string;

        /**
         * 「scrollSyncTitle」は、画面または通知へ表示する文言を保持します。
         */
        scrollSyncTitle: string;

        /**
         * 「search」は、対象の内容または識別子を表す文字列です。
         */
        search: string;

        /**
         * 「split」は、対象の内容または識別子を表す文字列です。
         */
        split: string;

        /**
         * 「textOnly」は、画面または通知へ表示する文言を保持します。
         */
        textOnly: string;

        /**
         * 「previewOnly」は、対象の内容または識別子を表す文字列です。
         */
        previewOnly: string;

        /**
         * 「pin」は、対象の内容または識別子を表す文字列です。
         */
        pin: string;

        /**
         * 「unpin」は、対象の内容または識別子を表す文字列です。
         */
        unpin: string;

        /**
         * 「collapse」は、対象の内容または識別子を表す文字列です。
         */
        collapse: string;

        /**
         * 「expand」は、対象の内容または識別子を表す文字列です。
         */
        expand: string;

        /**
         * 「groups」は、言語別メッセージまたは表示用データの一項目です。
         */
        groups: {

            /**
             * 「history」は、対象の内容または識別子を表す文字列です。
             */
            history: string;

            /**
             * 「paragraph」は、対象の内容または識別子を表す文字列です。
             */
            paragraph: string;

            /**
             * 「textFormat」は、画面または通知へ表示する文言を保持します。
             */
            textFormat: string;

            /**
             * 「clear」は、対象の内容または識別子を表す文字列です。
             */
            clear: string;

            /**
             * 「basic」は、対象の内容または識別子を表す文字列です。
             */
            basic: string;

            /**
             * 「block」は、対象の内容または識別子を表す文字列です。
             */
            block: string;

            /**
             * 「assist」は、対象の内容または識別子を表す文字列です。
             */
            assist: string;

            /**
             * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            rows: string;

            /**
             * 「columns」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            columns: string;

            /**
             * 「alignment」は、対象の内容または識別子を表す文字列です。
             */
            alignment: string;

            /**
             * 「excel」は、対象の内容または識別子を表す文字列です。
             */
            excel: string;

            /**
             * 「pane」は、対象の内容または識別子を表す文字列です。
             */
            pane: string;

            /**
             * 「pdf」は、対象の内容または識別子を表す文字列です。
             */
            pdf: string;

            /**
             * 「html」は、解析・編集・変換の対象となる本文またはデータを保持します。
             */
            html: string;

            /**
             * 「inspection」は、対象の内容または識別子を表す文字列です。
             */
            inspection: string;

            /**
             * 「help」は、対象の内容または識別子を表す文字列です。
             */
            help: string;
        };

        /**
         * 「labels」は、画面または通知へ表示する文言を保持します。
         */
        labels: {

            /**
             * 「undo」は、対象の内容または識別子を表す文字列です。
             */
            undo: string;

            /**
             * 「redo」は、対象の内容または識別子を表す文字列です。
             */
            redo: string;

            /**
             * 「style」は、表示テーマまたはスタイル設定を保持します。
             */
            style: string;

            /**
             * 「body」は、画面または通知へ表示する文言を保持します。
             */
            body: string;
            /**
             * 「heading」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param level 「level」は、「heading」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「heading」が生成または変換した言語別メッセージの文字列を返します。
             */
            heading: (level: number) => string;

            /**
             * 「quote」は、対象の内容または識別子を表す文字列です。
             */
            quote: string;

            /**
             * 「bulletList」は、対象の内容または識別子を表す文字列です。
             */
            bulletList: string;

            /**
             * 「orderedList」は、対象の内容または識別子を表す文字列です。
             */
            orderedList: string;

            /**
             * 「taskList」は、対象の内容または識別子を表す文字列です。
             */
            taskList: string;

            /**
             * 「indent」は、対象の内容または識別子を表す文字列です。
             */
            indent: string;

            /**
             * 「outdent」は、対象の内容または識別子を表す文字列です。
             */
            outdent: string;

            /**
             * 「bold」は、対象の内容または識別子を表す文字列です。
             */
            bold: string;

            /**
             * 「italic」は、対象の内容または識別子を表す文字列です。
             */
            italic: string;

            /**
             * 「strike」は、対象の内容または識別子を表す文字列です。
             */
            strike: string;

            /**
             * 「underline」は、対象の内容または識別子を表す文字列です。
             */
            underline: string;

            /**
             * 「highlight」は、対象の内容または識別子を表す文字列です。
             */
            highlight: string;

            /**
             * 「code」は、対象の内容または識別子を表す文字列です。
             */
            code: string;

            /**
             * 「superscript」は、対象の内容または識別子を表す文字列です。
             */
            superscript: string;

            /**
             * 「subscript」は、対象の内容または識別子を表す文字列です。
             */
            subscript: string;

            /**
             * 「clearInline」は、対象の内容または識別子を表す文字列です。
             */
            clearInline: string;

            /**
             * 「clearBlock」は、対象の内容または識別子を表す文字列です。
             */
            clearBlock: string;

            /**
             * 「clearAll」は、対象の内容または識別子を表す文字列です。
             */
            clearAll: string;

            /**
             * 「unlink」は、対象の内容または識別子を表す文字列です。
             */
            unlink: string;

            /**
             * 「link」は、対象の内容または識別子を表す文字列です。
             */
            link: string;

            /**
             * 「image」は、対象の内容または識別子を表す文字列です。
             */
            image: string;

            /**
             * 「tableSize」は、件数・容量・上限などの数値を保持します。
             */
            tableSize: string;

            /**
             * 「rows」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            rows: string;

            /**
             * 「columns」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            columns: string;

            /**
             * 「insertTable」は、対象の内容または識別子を表す文字列です。
             */
            insertTable: string;

            /**
             * 「horizontalRule」は、対象の内容または識別子を表す文字列です。
             */
            horizontalRule: string;

            /**
             * 「hardBreak」は、対象の内容または識別子を表す文字列です。
             */
            hardBreak: string;

            /**
             * 「language」は、対象の内容または識別子を表す文字列です。
             */
            language: string;

            /**
             * 「codeBlock」は、対象の内容または識別子を表す文字列です。
             */
            codeBlock: string;

            /**
             * 「math」は、対象の内容または識別子を表す文字列です。
             */
            math: string;

            /**
             * 「footnote」は、対象の内容または識別子を表す文字列です。
             */
            footnote: string;

            /**
             * 「toc」は、対象の内容または識別子を表す文字列です。
             */
            toc: string;

            /**
             * 「pageBreak」は、対象の内容または識別子を表す文字列です。
             */
            pageBreak: string;

            /**
             * 「emoji」は、対象の内容または識別子を表す文字列です。
             */
            emoji: string;

            /**
             * 「insertEmoji」は、対象の内容または識別子を表す文字列です。
             */
            insertEmoji: string;

            /**
             * 「addBefore」は、対象の内容または識別子を表す文字列です。
             */
            addBefore: string;

            /**
             * 「addAfter」は、対象の内容または識別子を表す文字列です。
             */
            addAfter: string;

            /**
             * 「addLeft」は、対象の内容または識別子を表す文字列です。
             */
            addLeft: string;

            /**
             * 「addRight」は、対象の内容または識別子を表す文字列です。
             */
            addRight: string;

            /**
             * 「deleteRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteRow: string;

            /**
             * 「toggleHeader」は、対象の内容または識別子を表す文字列です。
             */
            toggleHeader: string;

            /**
             * 「deleteColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteColumn: string;

            /**
             * 「alignLeft」は、対象の内容または識別子を表す文字列です。
             */
            alignLeft: string;

            /**
             * 「alignCenter」は、対象の内容または識別子を表す文字列です。
             */
            alignCenter: string;

            /**
             * 「alignRight」は、対象の内容または識別子を表す文字列です。
             */
            alignRight: string;

            /**
             * 「alignColumns」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            alignColumns: string;

            /**
             * 「cellBreak」は、対象の内容または識別子を表す文字列です。
             */
            cellBreak: string;

            /**
             * 「copyTsv」は、対象の内容または識別子を表す文字列です。
             */
            copyTsv: string;

            /**
             * 「printPreview」は、対象の内容または識別子を表す文字列です。
             */
            printPreview: string;

            /**
             * 「exportPdf」は、対象の内容または識別子を表す文字列です。
             */
            exportPdf: string;

            /**
             * 「exportHtml」は、対象の内容または識別子を表す文字列です。
             */
            exportHtml: string;

            /**
             * 「embedImages」は、対象の内容または識別子を表す文字列です。
             */
            embedImages: string;

            /**
             * 「convertLinkedMarkdown」は、対象の内容または識別子を表す文字列です。
             */
            convertLinkedMarkdown: string;

            /**
             * 「saveWithoutDialog」は、対象の内容または識別子を表す文字列です。
             */
            saveWithoutDialog: string;

            /**
             * 「preflight」は、対象の内容または識別子を表す文字列です。
             */
            preflight: string;

            /**
             * 「shortcuts」は、対象の内容または識別子を表す文字列です。
             */
            shortcuts: string;

            /**
             * 「features」は、対象の内容または識別子を表す文字列です。
             */
            features: string;

            /**
             * 「markdownSupport」は、対象の内容または識別子を表す文字列です。
             */
            markdownSupport: string;

            /**
             * 「about」は、対象の内容または識別子を表す文字列です。
             */
            about: string;

            /**
             * 「header」は、対象の内容または識別子を表す文字列です。
             */
            header: string;

            /**
             * 「headerPlaceholder」は、対象の内容または識別子を表す文字列です。
             */
            headerPlaceholder: string;
        };

        /**
         * 「featureDescriptions」は、言語別メッセージまたは表示用データの一項目です。
         */
        featureDescriptions: {

            /**
             * 「undo」は、対象の内容または識別子を表す文字列です。
             */
            undo: string;

            /**
             * 「redo」は、対象の内容または識別子を表す文字列です。
             */
            redo: string;

            /**
             * 「bold」は、対象の内容または識別子を表す文字列です。
             */
            bold: string;

            /**
             * 「italic」は、対象の内容または識別子を表す文字列です。
             */
            italic: string;

            /**
             * 「clearInline」は、対象の内容または識別子を表す文字列です。
             */
            clearInline: string;

            /**
             * 「clearBlock」は、対象の内容または識別子を表す文字列です。
             */
            clearBlock: string;

            /**
             * 「link」は、対象の内容または識別子を表す文字列です。
             */
            link: string;

            /**
             * 「image」は、対象の内容または識別子を表す文字列です。
             */
            image: string;

            /**
             * 「insertTable」は、対象の内容または識別子を表す文字列です。
             */
            insertTable: string;

            /**
             * 「codeBlock」は、対象の内容または識別子を表す文字列です。
             */
            codeBlock: string;

            /**
             * 「math」は、対象の内容または識別子を表す文字列です。
             */
            math: string;

            /**
             * 「footnote」は、対象の内容または識別子を表す文字列です。
             */
            footnote: string;

            /**
             * 「toc」は、対象の内容または識別子を表す文字列です。
             */
            toc: string;

            /**
             * 「addBefore」は、対象の内容または識別子を表す文字列です。
             */
            addBefore: string;

            /**
             * 「deleteRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteRow: string;

            /**
             * 「deleteColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteColumn: string;

            /**
             * 「alignLeft」は、対象の内容または識別子を表す文字列です。
             */
            alignLeft: string;

            /**
             * 「alignCenter」は、対象の内容または識別子を表す文字列です。
             */
            alignCenter: string;

            /**
             * 「alignRight」は、対象の内容または識別子を表す文字列です。
             */
            alignRight: string;

            /**
             * 「copyTsv」は、対象の内容または識別子を表す文字列です。
             */
            copyTsv: string;

            /**
             * 「tableEditor」は、対象の内容または識別子を表す文字列です。
             */
            tableEditor: string;

            /**
             * 「tableEditorColumnResize」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            tableEditorColumnResize: string;

            /**
             * 「tableEditorRowResize」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            tableEditorRowResize: string;

            /**
             * 「tableEditorLayout」は、対象の内容または識別子を表す文字列です。
             */
            tableEditorLayout: string;

            /**
             * 「outline」は、対象の内容または識別子を表す文字列です。
             */
            outline: string;

            /**
             * 「search」は、対象の内容または識別子を表す文字列です。
             */
            search: string;

            /**
             * 「split」は、対象の内容または識別子を表す文字列です。
             */
            split: string;

            /**
             * 「textOnly」は、画面または通知へ表示する文言を保持します。
             */
            textOnly: string;

            /**
             * 「previewOnly」は、対象の内容または識別子を表す文字列です。
             */
            previewOnly: string;

            /**
             * 「printPreview」は、対象の内容または識別子を表す文字列です。
             */
            printPreview: string;

            /**
             * 「exportPdf」は、対象の内容または識別子を表す文字列です。
             */
            exportPdf: string;

            /**
             * 「preflight」は、対象の内容または識別子を表す文字列です。
             */
            preflight: string;
        };

        /**
         * 「hintZoom」は、対象の内容または識別子を表す文字列です。
         */
        hintZoom: string;

        /**
         * 「codeLanguages」は、言語別メッセージまたは表示用データの一項目です。
         */
        codeLanguages: ReadonlyArray<{
        /**
         * 「value」は、対象の内容または識別子を表す文字列です。
         */
        value: string;
        /**
         * 「label」は、画面または通知へ表示する文言を保持します。
         */
        label: string }>;

        /**
         * 「snippets」は、言語別メッセージまたは表示用データの一項目です。
         */
        snippets: {
        /**
         * 「mermaid」は、対象の識別や処理分岐に使用する値を保持します。
         */
        mermaid: string;
        /**
         * 「footnote」は、対象の内容または識別子を表す文字列です。
         */
        footnote: string;
        /**
         * 「note」は、対象の内容または識別子を表す文字列です。
         */
        note: string;
        /**
         * 「warning」は、対象の内容または識別子を表す文字列です。
         */
        warning: string };

        /**
         * 「settings」は、利用側が共有する設定または現在状態を保持します。
         */
        settings: {

            /**
             * 「images」は、対象の内容または識別子を表す文字列です。
             */
            images: string;

            /**
             * 「imageDirectory」は、対象の内容または識別子を表す文字列です。
             */
            imageDirectory: string;

            /**
             * 「imageDirectoryPlaceholder」は、対象の内容または識別子を表す文字列です。
             */
            imageDirectoryPlaceholder: string;

            /**
             * 「imageDirectoryHint」は、対象の内容または識別子を表す文字列です。
             */
            imageDirectoryHint: string;

            /**
             * 「fonts」は、表示テーマまたはスタイル設定を保持します。
             */
            fonts: string;

            /**
             * 「fontSettings」は、利用側が共有する設定または現在状態を保持します。
             */
            fontSettings: string;

            /**
             * 「editorFontFamily」は、表示テーマまたはスタイル設定を保持します。
             */
            editorFontFamily: string;

            /**
             * 「previewFontFamily」は、表示テーマまたはスタイル設定を保持します。
             */
            previewFontFamily: string;

            /**
             * 「fontFamilyPlaceholder」は、表示テーマまたはスタイル設定を保持します。
             */
            fontFamilyPlaceholder: string;

            /**
             * 「fontFamilyHint」は、表示テーマまたはスタイル設定を保持します。
             */
            fontFamilyHint: string;

            /**
             * 「apply」は、対象の内容または識別子を表す文字列です。
             */
            apply: string;
        };
    };

    /**
     * 「app」は、言語別メッセージまたは表示用データの一項目です。
     */
    app: {

        /**
         * 「startup」は、対象の内容または識別子を表す文字列です。
         */
        startup: string;

        /**
         * 「outline」は、対象の内容または識別子を表す文字列です。
         */
        outline: string;

        /**
         * 「hideOutline」は、対象の内容または識別子を表す文字列です。
         */
        hideOutline: string;

        /**
         * 「showOutline」は、対象の内容または識別子を表す文字列です。
         */
        showOutline: string;

        /**
         * 「outlineWidth」は、対象の位置、サイズ、件数、または範囲を保持します。
         */
        outlineWidth: string;

        /**
         * 「noHeadings」は、対象の内容または識別子を表す文字列です。
         */
        noHeadings: string;

        /**
         * 「searchAndReplace」は、対象の内容または識別子を表す文字列です。
         */
        searchAndReplace: string;

        /**
         * 「searchText」は、画面または通知へ表示する文言を保持します。
         */
        searchText: string;

        /**
         * 「replacementText」は、画面または通知へ表示する文言を保持します。
         */
        replacementText: string;

        /**
         * 「replacement」は、対象の内容または識別子を表す文字列です。
         */
        replacement: string;

        /**
         * 「previousMatch」は、対象の内容または識別子を表す文字列です。
         */
        previousMatch: string;

        /**
         * 「nextMatch」は、対象の内容または識別子を表す文字列です。
         */
        nextMatch: string;

        /**
         * 「replaceAll」は、対象の内容または識別子を表す文字列です。
         */
        replaceAll: string;

        /**
         * 「close」は、対象の内容または識別子を表す文字列です。
         */
        close: string;

        /**
         * 「splitBoundary」は、対象の内容または識別子を表す文字列です。
         */
        splitBoundary: string;

        /**
         * 「selectionFormatting」は、対象の内容または識別子を表す文字列です。
         */
        selectionFormatting: string;

        /**
         * 「diagnosticsTitle」は、画面または通知へ表示する文言を保持します。
         */
        diagnosticsTitle: string;

        /**
         * 「diagnosticHelp」は、対象の内容または識別子を表す文字列です。
         */
        diagnosticHelp: string;

        /**
         * 「noProblems」は、対象の内容または識別子を表す文字列です。
         */
        noProblems: string;

        /**
         * 「severity」は、言語別メッセージまたは表示用データの一項目です。
         */
        severity: {
        /**
         * 「error」は、対象の内容または識別子を表す文字列です。
         */
        error: string;
        /**
         * 「warning」は、対象の内容または識別子を表す文字列です。
         */
        warning: string;
        /**
         * 「info」は、対象の内容または識別子を表す文字列です。
         */
        info: string };
        /**
         * 「line」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param line 「line」は、「line」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「line」が生成または変換した言語別メッセージの文字列を返します。
         */
        line: (line: number) => string;

        /**
         * 「printSettings」は、利用側が共有する設定または現在状態を保持します。
         */
        printSettings: string;

        /**
         * 「printSettingsHelp」は、利用側が共有する設定または現在状態を保持します。
         */
        printSettingsHelp: string;

        /**
         * 「paper」は、対象の内容または識別子を表す文字列です。
         */
        paper: string;

        /**
         * 「orientation」は、対象の内容または識別子を表す文字列です。
         */
        orientation: string;

        /**
         * 「portrait」は、対象の内容または識別子を表す文字列です。
         */
        portrait: string;

        /**
         * 「landscape」は、対象の内容または識別子を表す文字列です。
         */
        landscape: string;

        /**
         * 「header」は、対象の内容または識別子を表す文字列です。
         */
        header: string;

        /**
         * 「footer」は、対象の内容または識別子を表す文字列です。
         */
        footer: string;

        /**
         * 「margins」は、対象の内容または識別子を表す文字列です。
         */
        margins: string;

        /**
         * 「top」は、対象の内容または識別子を表す文字列です。
         */
        top: string;

        /**
         * 「right」は、対象の内容または識別子を表す文字列です。
         */
        right: string;

        /**
         * 「bottom」は、対象の内容または識別子を表す文字列です。
         */
        bottom: string;

        /**
         * 「left」は、対象の内容または識別子を表す文字列です。
         */
        left: string;

        /**
         * 「withoutDialog」は、対象の内容または識別子を表す文字列です。
         */
        withoutDialog: string;
        /**
         * PDF印刷設定パネルのタイポグラフィ欄に表示する見出し。
         */
        typography: string;

        /**
         * 「fontFamily」は、表示テーマまたはスタイル設定を保持します。
         */
        fontFamily: string;

        /**
         * 「bodyFontSize」は、画面または通知へ表示する文言を保持します。
         */
        bodyFontSize: string;

        /**
         * 「headingFontSizes」は、表示テーマまたはスタイル設定を保持します。
         */
        headingFontSizes: string;

        /**
         * 「codeFontSize」は、表示テーマまたはスタイル設定を保持します。
         */
        codeFontSize: string;

        /**
         * 「lineHeight」は、対象の位置、サイズ、件数、または範囲を保持します。
         */
        lineHeight: string;

        /**
         * 「paragraphSpacing」は、対象の内容または識別子を表す文字列です。
         */
        paragraphSpacing: string;

        /**
         * 「status」は、言語別メッセージまたは表示用データの一項目です。
         */
        status: {

            /**
             * 「modeSplit」は、対象の内容または識別子を表す文字列です。
             */
            modeSplit: string;

            /**
             * 「modePreview」は、対象の内容または識別子を表す文字列です。
             */
            modePreview: string;
            /**
             * 「lines」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @returns 「lines」が生成または変換した言語別メッセージの文字列を返します。
             */
            lines: (count: number) => string;
            /**
             * 「textCharacters」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @returns 「textCharacters」が生成した言語別メッセージの表示文字列を返します。
             */
            textCharacters: (count: number) => string;
            /**
             * 「markdownCharacters」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @returns 「markdownCharacters」が生成または変換した言語別メッセージの文字列を返します。
             */
            markdownCharacters: (count: number) => string;
            /**
             * 「zoom」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param percent 「percent」は、「zoom」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「zoom」が生成または変換した言語別メッセージの文字列を返します。
             */
            zoom: (percent: number) => string;

            /**
             * 「syncing」は、対象の内容または識別子を表す文字列です。
             */
            syncing: string;

            /**
             * 「synced」は、対象の内容または識別子を表す文字列です。
             */
            synced: string;
        };

        /**
         * 「inspector」は、言語別メッセージまたは表示用データの一項目です。
         */
        inspector: {
        /**
         * 「mermaid」は、対象の識別や処理分岐に使用する値を保持します。
         */
        mermaid: string;
        /**
         * 「math」は、対象の内容または識別子を表す文字列です。
         */
        math: string;
        /**
         * 「image」は、対象の内容または識別子を表す文字列です。
         */
        image: string;
        /**
         * 「alt」は、対象の内容または識別子を表す文字列です。
         */
        alt: string;
        /**
         * 「reference」は、対象の内容または識別子を表す文字列です。
         */
        reference: string;
        /**
         * 「openFile」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
         */
        openFile: string;
        /**
         * 「apply」は、対象の内容または識別子を表す文字列です。
         */
        apply: string };

        /**
         * 「link」は、言語別メッセージまたは表示用データの一項目です。
         */
        link: {
        /**
         * 「title」は、画面または通知へ表示する文言を保持します。
         */
        title: string;
        /**
         * 「url」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
         */
        url: string;
        /**
         * 「urlPlaceholder」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
         */
        urlPlaceholder: string;
        /**
         * 「text」は、画面または通知へ表示する文言を保持します。
         */
        text: string;
        /**
         * 「textHint」は、画面または通知へ表示する文言を保持します。
         */
        textHint: string;
        /**
         * 「cancel」は、対象の内容または識別子を表す文字列です。
         */
        cancel: string;
        /**
         * 「insert」は、対象の内容または識別子を表す文字列です。
         */
        insert: string };

        /**
         * 「tableEditor」は、言語別メッセージまたは表示用データの一項目です。
         */
        tableEditor: {

            /**
             * 「title」は、画面または通知へ表示する文言を保持します。
             */
            title: string;

            /**
             * 「close」は、対象の内容または識別子を表す文字列です。
             */
            close: string;

            /**
             * 「addRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            addRow: string;

            /**
             * 「deleteRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteRow: string;

            /**
             * 「addColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            addColumn: string;

            /**
             * 「deleteColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            deleteColumn: string;

            /**
             * 「alignLeft」は、対象の内容または識別子を表す文字列です。
             */
            alignLeft: string;

            /**
             * 「alignCenter」は、対象の内容または識別子を表す文字列です。
             */
            alignCenter: string;

            /**
             * 「alignRight」は、対象の内容または識別子を表す文字列です。
             */
            alignRight: string;

            /**
             * 「clearAlignment」は、対象の内容または識別子を表す文字列です。
             */
            clearAlignment: string;

            /**
             * 「copyTsv」は、対象の内容または識別子を表す文字列です。
             */
            copyTsv: string;

            /**
             * 「copyColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            copyColumn: string;

            /**
             * 「copyRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            copyRow: string;

            /**
             * 「cancel」は、対象の内容または識別子を表す文字列です。
             */
            cancel: string;

            /**
             * 「apply」は、対象の内容または識別子を表す文字列です。
             */
            apply: string;

            /**
             * 「navigationHint」は、対象の内容または識別子を表す文字列です。
             */
            navigationHint: string;

            /**
             * 「sourceEditorRequired」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
             */
            sourceEditorRequired: string;

            /**
             * 「tableRequired」は、対象の内容または識別子を表す文字列です。
             */
            tableRequired: string;
            /**
             * 「rowColumnLimit」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param rows 「rows」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
             * @param columns 「columns」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
             * @returns 「rowColumnLimit」が生成または変換した言語別メッセージの文字列を返します。
             */
            rowColumnLimit: (rows: number, columns: number) => string;

            /**
             * 「copied」は、対象の内容または識別子を表す文字列です。
             */
            copied: string;

            /**
             * 「sourceEditorClosed」は、読み込みまたは出力対象を示すパス・URL・内容を保持します。
             */
            sourceEditorClosed: string;

            /**
             * 「documentChanged」は、対象の内容または識別子を表す文字列です。
             */
            documentChanged: string;

            /**
             * 「resizeColumn」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            resizeColumn: string;

            /**
             * 「resizeRow」は、対象の位置、サイズ、件数、または範囲を保持します。
             */
            resizeRow: string;

            /**
             * 「resizeEditor」は、件数・容量・上限などの数値を保持します。
             */
            resizeEditor: string;
        };

        /**
         * 「help」は、言語別メッセージまたは表示用データの一項目です。
         */
        help: {

            /**
             * 「shortcuts」は、対象の内容または識別子を表す文字列です。
             */
            shortcuts: string;

            /**
             * 「markdown」は、解析・編集・変換の対象となる本文またはデータを保持します。
             */
            markdown: string;

            /**
             * 「about」は、対象の内容または識別子を表す文字列です。
             */
            about: string;

            /**
             * 「shortcutImage」は、対象の内容または識別子を表す文字列です。
             */
            shortcutImage: string;

            /**
             * 「shortcutTableBreak」は、対象の内容または識別子を表す文字列です。
             */
            shortcutTableBreak: string;

            /**
             * 「markdownIntro」は、対象の内容または識別子を表す文字列です。
             */
            markdownIntro: string;

            /**
             * 「markdownFeatures」は、対象の内容または識別子を表す文字列です。
             */
            markdownFeatures: string;

            /**
             * 「aboutIntro」は、対象の内容または識別子を表す文字列です。
             */
            aboutIntro: string;

            /**
             * 「aboutFeatures」は、対象の内容または識別子を表す文字列です。
             */
            aboutFeatures: string;
        };

        /**
         * 「toast」は、言語別メッセージまたは表示用データの一項目です。
         */
        toast: {
            /**
             * 「imagesSaved」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @returns 「imagesSaved」が生成または変換した言語別メッセージの文字列を返します。
             */
            imagesSaved: (count: number) => string;
            /**
             * 「pdfResourceWarnings」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @param detail 「detail」は、「pdfResourceWarnings」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「pdfResourceWarnings」が生成または変換した言語別メッセージの文字列を返します。
             */
            pdfResourceWarnings: (count: number, detail: string) => string;
            /**
             * 「preflightSummary」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param errors 「errors」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
             * @param warnings 「warnings」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
             * @param infos 「infos」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「preflightSummary」が生成または変換した言語別メッセージの文字列を返します。
             */
            preflightSummary: (errors: number, warnings: number, infos: number) => string;
            /**
             * 「imageSaveFailed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「imageSaveFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「imageSaveFailed」が生成または変換した言語別メッセージの文字列を返します。
             */
            imageSaveFailed: (detail: string) => string;
            /**
             * 「pdfExportFailed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「pdfExportFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「pdfExportFailed」が生成または変換した言語別メッセージの文字列を返します。
             */
            pdfExportFailed: (detail: string) => string;
            /**
             * 「resourceCheckFailed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「resourceCheckFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @param duringPdf 「duringPdf」は、「resourceCheckFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「resourceCheckFailed」が生成または変換した言語別メッセージの文字列を返します。
             */
            resourceCheckFailed: (detail: string, duringPdf: boolean) => string;
            /**
             * 「operationFailed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「operationFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「operationFailed」が生成または変換した言語別メッセージの文字列を返します。
             */
            operationFailed: (detail: string) => string;
            /**
             * 「pdfExported」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
             * @returns 「pdfExported」が生成または変換した言語別メッセージの文字列を返します。
             */
            pdfExported: (path: string) => string;
            /**
             * 「htmlExported」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @returns 「htmlExported」が生成または変換した言語別メッセージの文字列を返します。
             */
            htmlExported: (path: string, count: number) => string;
            /**
             * 「htmlExportFailed」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「htmlExportFailed」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「htmlExportFailed」が生成または変換した言語別メッセージの文字列を返します。
             */
            htmlExportFailed: (detail: string) => string;

            /**
             * 「tableCellRequired」は、対象の内容または識別子を表す文字列です。
             */
            tableCellRequired: string;

            /**
             * 「cannotPasteTsv」は、対象の内容または識別子を表す文字列です。
             */
            cannotPasteTsv: string;

            /**
             * 「tableCopied」は、対象の内容または識別子を表す文字列です。
             */
            tableCopied: string;
            /**
             * 「cannotCopyTsv」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「cannotCopyTsv」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「cannotCopyTsv」が生成または変換した言語別メッセージの文字列を返します。
             */
            cannotCopyTsv: (detail?: string) => string;

            /**
             * 「workspaceTrustRequired」は、対象の内容または識別子を表す文字列です。
             */
            workspaceTrustRequired: string;
            /**
             * 「pdfStartedWithDiagnostics」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @param detail 「detail」は、「pdfStartedWithDiagnostics」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「pdfStartedWithDiagnostics」が生成または変換した言語別メッセージの文字列を返します。
             */
            pdfStartedWithDiagnostics: (count: number, detail: string) => string;
            /**
             * 「pdfFallbackToMarkdown」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param detail 「detail」は、「pdfFallbackToMarkdown」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「pdfFallbackToMarkdown」が生成または変換した言語別メッセージの文字列を返します。
             */
            pdfFallbackToMarkdown: (detail?: string) => string;
        };

        /**
         * 「errors」は、言語別メッセージまたは表示用データの一項目です。
         */
        errors: {

            /**
             * 「ackMismatch」は、対象の内容または識別子を表す文字列です。
             */
            ackMismatch: string;
            /**
             * 「pendingOperationChain」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param opId 「opId」は、「pendingOperationChain」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「pendingOperationChain」が生成または変換した言語別メッセージの文字列を返します。
             */
            pendingOperationChain: (opId: string) => string;

            /**
             * 「clipboardUnavailable」は、対象の内容または識別子を表す文字列です。
             */
            clipboardUnavailable: string;

            /**
             * 「bmpConversion」は、対象の内容または識別子を表す文字列です。
             */
            bmpConversion: string;
            /**
             * 「imageSize」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
             * @param maxSizeMb 「maxSizeMb」は、「imageSize」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「imageSize」が生成または変換した言語別メッセージの文字列を返します。
             */
            imageSize: (maxSizeMb: number) => string;
        };
    };

    /**
     * 「renderer」は、言語別メッセージまたは表示用データの一項目です。
     */
    renderer: {

        /**
         * 「remoteImageDisabled」は、対象の内容または識別子を表す文字列です。
         */
        remoteImageDisabled: string;

        /**
         * 「copy」は、対象の内容または識別子を表す文字列です。
         */
        copy: string;

        /**
         * 「copied」は、対象の内容または識別子を表す文字列です。
         */
        copied: string;

        /**
         * 「pageBreak」は、対象の内容または識別子を表す文字列です。
         */
        pageBreak: string;

        /**
         * 「toc」は、対象の内容または識別子を表す文字列です。
         */
        toc: string;

        /**
         * 「backToText」は、画面または通知へ表示する文言を保持します。
         */
        backToText: string;

        /**
         * 「mathError」は、対象の内容または識別子を表す文字列です。
         */
        mathError: string;

        /**
         * 「mermaidError」は、対象の内容または識別子を表す文字列です。
         */
        mermaidError: string;

        /**
         * 「alerts」は、言語別メッセージまたは表示用データの一項目です。
         */
        alerts: {
        /**
         * 「note」は、対象の内容または識別子を表す文字列です。
         */
        note: string;
        /**
         * 「tip」は、対象の内容または識別子を表す文字列です。
         */
        tip: string;
        /**
         * 「important」は、対象の内容または識別子を表す文字列です。
         */
        important: string;
        /**
         * 「warning」は、対象の内容または識別子を表す文字列です。
         */
        warning: string;
        /**
         * 「caution」は、対象の内容または識別子を表す文字列です。
         */
        caution: string };
    };

    /**
     * 「diagnostics」は、言語別メッセージまたは表示用データの一項目です。
     */
    diagnostics: {
        /**
         * 「unclosedFence」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param marker 「marker」は、「unclosedFence」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「unclosedFence」が生成または変換した言語別メッセージの文字列を返します。
         */
        unclosedFence: (marker: string) => string;
        /**
         * 「duplicateHeading」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param id 「id」は、「duplicateHeading」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「duplicateHeading」が生成または変換した言語別メッセージの文字列を返します。
         */
        duplicateHeading: (id: string) => string;

        /**
         * 「invalidTableSeparator」は、対象の内容または識別子を表す文字列です。
         */
        invalidTableSeparator: string;

        /**
         * 「emptyImageAlt」は、対象の内容または識別子を表す文字列です。
         */
        emptyImageAlt: string;
        /**
         * 「localImageCheck」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param source 処理対象のソースです。
         * @returns 「localImageCheck」が生成または変換した言語別メッセージの文字列を返します。
         */
        localImageCheck: (source: string) => string;

        /**
         * 「emptyTableHeader」は、対象の内容または識別子を表す文字列です。
         */
        emptyTableHeader: string;
        /**
         * 「tableColumnMismatch」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param header 「header」は、「tableColumnMismatch」が言語別メッセージ処理の処理対象を特定する入力です。
         * @param separator 「separator」は、「tableColumnMismatch」が言語別メッセージ処理の処理対象を特定する入力です。
         * @param kind 対象の種別または処理経路を選択する識別値です。
         * @returns 「tableColumnMismatch」が生成または変換した言語別メッセージの文字列を返します。
         */
        tableColumnMismatch: (header: number, separator: number, kind: 'separator' | 'body') => string;
        /**
         * 「missingReference」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param label 「label」は、「missingReference」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「missingReference」が生成または変換した言語別メッセージの文字列を返します。
         */
        missingReference: (label: string) => string;
        /**
         * 「localResource」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param kind 対象の種別または処理経路を選択する識別値です。
         * @param missing 「missing」は、「localResource」が言語別メッセージ処理の処理対象を特定する入力です。
         * @param source 処理対象のソースです。
         * @param detail 「detail」は、「localResource」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「localResource」が生成または変換した言語別メッセージの文字列を返します。
         */
        localResource: (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => string;
    };

    /**
     * 「host」は、言語別メッセージまたは表示用データの一項目です。
     */
    host: {

        /**
         * 「pdfTrustRequired」は、対象の内容または識別子を表す文字列です。
         */
        pdfTrustRequired: string;

        /**
         * 「pdfProgress」は、対象の内容または識別子を表す文字列です。
         */
        pdfProgress: string;
        /**
         * 「pdfExported」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
         * @returns 「pdfExported」が生成または変換した言語別メッセージの文字列を返します。
         */
        pdfExported: (path: string) => string;

        /**
         * 「htmlTrustRequired」は、対象の内容または識別子を表す文字列です。
         */
        htmlTrustRequired: string;

        /**
         * 「htmlProgress」は、対象の内容または識別子を表す文字列です。
         */
        htmlProgress: string;
        /**
         * 「htmlExported」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
         * @returns 「htmlExported」が生成または変換した言語別メッセージの文字列を返します。
         */
        htmlExported: (path: string) => string;

        /**
         * 「htmlRenderTimeout」は、対象の内容または識別子を表す文字列です。
         */
        htmlRenderTimeout: string;

        /**
         * 「open」は、対象の内容または識別子を表す文字列です。
         */
        open: string;

        /**
         * 「saveCanceled」は、対象の内容または識別子を表す文字列です。
         */
        saveCanceled: string;

        /**
         * 「imageDocumentMustBeSaved」は、対象の内容または識別子を表す文字列です。
         */
        imageDocumentMustBeSaved: string;
        /**
         * 「unsupportedImage」を呼び出す側と実装側で、入力形式と結果の契約を共有します。
         * @param mime 「mime」は、「unsupportedImage」が言語別メッセージ処理の処理対象を特定する入力です。
         * @returns 「unsupportedImage」が生成または変換した言語別メッセージの文字列を返します。
         */
        unsupportedImage: (mime: string) => string;

        /**
         * 「invalidImageDirectory」は、対象の内容または識別子を表す文字列です。
         */
        invalidImageDirectory: string;

        /**
         * 「pdfBrowserUnavailable」は、対象の位置、サイズ、件数、または範囲を保持します。
         */
        pdfBrowserUnavailable: string;

        /**
         * 「errorPrefix」は、対象の内容または識別子を表す文字列です。
         */
        errorPrefix: string;

        /**
         * 「clientIdMismatch」は、対象の内容または識別子を表す文字列です。
         */
        clientIdMismatch: string;
    };

    /**
     * 「editor」は、言語別メッセージまたは表示用データの一項目です。
     */
    editor: {
    /**
     * 「placeholder」は、対象の内容または識別子を表す文字列です。
     */
    placeholder: string;
    /**
     * 「codePlaceholder」は、対象の内容または識別子を表す文字列です。
     */
    codePlaceholder: string;
    /**
     * 「defaultLinkLabel」は、画面または通知へ表示する文言を保持します。
     */
    defaultLinkLabel: string;
    /**
     * 「defaultImageAlt」は、対象の内容または識別子を表す文字列です。
     */
    defaultImageAlt: string;
    /**
     * 「plainText」は、画面または通知へ表示する文言を保持します。
     */
    plainText: string };

    /**
     * 「internal」は、言語別メッセージまたは表示用データの一項目です。
     */
    internal: {
    /**
     * 「concurrentEditsOverlap」は、対象の内容または識別子を表す文字列です。
     */
    concurrentEditsOverlap: string;
    /**
     * 「rootNotFound」は、対象の内容または識別子を表す文字列です。
     */
    rootNotFound: string };
}

/**
 * 「RawCatalog」として扱う値の型を定義します。
 */
type RawCatalog = Record<string, unknown>;
/**
 * 「RawLocales」として扱う値の型を定義します。
 */
type RawLocales = Record<SupportedLanguage, RawCatalog>;
/**
 * 「Values」として扱う値の型を定義します。
 */
type Values = Record<string, string | number>;

/** 「rawLocales」は、関連する処理間で共有する設定値または状態です。 */
/** 生成済みロケールJSONを型付きカタログとして参照する共有データ。 */
const rawLocales = localeCatalog as RawLocales;

/**
 * 言語を正規化します。
 * @param value 「normalizeLanguage」で検証・変換する入力値です。
 * @returns 「normalizeLanguage」が生成または変換した言語別メッセージの文字列を返します。
 */
function normalizeLanguage(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/_/g, '-');
}

/**
 * 「languageFromLocale」は、言語や通信契約に応じた表示文言または対応表を保持します。
 * @param value 「languageFromLocale」で検証・変換する入力値です。
 * @returns 「languageFromLocale」が対象を取得できない場合はundefinedを返します。
 */
function languageFromLocale(value: string | undefined): SupportedLanguage | undefined {
    const normalized = normalizeLanguage(value);
    if (!normalized) return undefined;
    if (normalized === 'zh' || normalized.startsWith('zh-cn')) return 'zh-cn';
    const primary = normalized.split('-')[0];
    return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? primary as SupportedLanguage : undefined;
}

/**
 * 言語を取得または解決します。
 * @param setting 保存済み設定または処理経路を選択するオプションです。未設定時の既定値や正規化対象を含みます。
 * @param vscodeLanguage 「vscodeLanguage」は、「resolveLanguage」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 正規化した設定値またはVS Codeロケールから解決したSupportedLanguageを返し、解決できない場合はenへフォールバックします。
 */
export function resolveLanguage(setting: string | undefined, vscodeLanguage?: string): SupportedLanguage {
    const normalized = normalizeLanguage(setting);
    if (normalized && normalized !== 'auto') return languageFromLocale(normalized) ?? 'en';
    return languageFromLocale(vscodeLanguage) ?? 'en';
}

/**
 * resolve・catalogを取得または解決します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 指定されたSupportedLanguageに対応するローカライズ済みRawCatalogを返します。
 */
function resolveCatalog(language: SupportedLanguage): RawCatalog {
    return rawLocales[language];
}

/**
 * readを取得または解決します。
 * @param catalog 「catalog」は、「read」が言語別メッセージ処理の処理対象を特定する入力です。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @returns 「read」が生成または変換した言語別メッセージの文字列を返します。
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
 * 「interpolate」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
 * @param template 「template」は、「interpolate」が言語別メッセージ処理の処理対象を特定する入力です。
 * @param values 「values」は、「interpolate」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「interpolate」が生成または変換した言語別メッセージの文字列を返します。
 */
function interpolate(template: string, values: Values = {}): string {
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,
    /**
 * テスト「.」の前提条件を設定し、期待結果を検証するコールバックです。
     * @param match matchとして渡される、このコールバックの入力値です。
     * @param key メッセージまたは設定表から値を取得する識別キーです。
     * @returns テストの前提条件と期待結果を検証し、値を返しません。
     */
    (match, key: string) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
    ));
}

/**
 * create・messagesを作成または組み立てます。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @returns 「createMessages」が生成したデータまたはオブジェクトを返します。
 */
function createMessages(language: SupportedLanguage): Messages {
    const raw = resolveCatalog(language) as Record<string, any>;

    /**
     * 「text」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
     * @param key メッセージまたは設定表から値を取得する識別キーです。
     * @param values 「values」は、「text」が言語別メッセージで処理する対象を特定する入力です。
     * @returns 「text」が生成した言語別メッセージの表示文字列を返します。
     */
    const text = /**
 * 「text」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param key メッセージまたは設定表から値を取得する識別キーです。
 * @param values 「values」は、「text」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「text」が生成した言語別の表示文言またはメッセージを返します。
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

                /**
                 * 「heading」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param level 「level」は、「heading」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「heading」が生成した言語別の表示文言またはメッセージを返します。
                 */
                heading: /**
 * 「heading」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param level 処理対象を特定する位置、範囲、または数量です。
 * @returns 「heading」が生成した言語別の表示文言またはメッセージを返します。
 */ (level: number) => text('ribbon.labels.heading', { level }),
                exportHtml: raw.ribbon.labels.exportHtml,
                embedImages: raw.ribbon.labels.embedImages,
                convertLinkedMarkdown: raw.ribbon.labels.convertLinkedMarkdown,
                saveWithoutDialog: raw.ribbon.labels.saveWithoutDialog
            },
            featureDescriptions: raw.ribbon.labels.featureDescriptions,
            hintZoom: raw.ribbon.hintZoom,
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

            /**
             * 「line」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param line 「line」は、「line」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「line」が生成した言語別の表示文言またはメッセージを返します。
             */
            line: /**
 * 「line」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param line 「line」は、「line」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「line」が生成した言語別の表示文言またはメッセージを返します。
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

                /**
                 * 「lines」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @returns 「lines」が生成した言語別の表示文言またはメッセージを返します。
                 */
                lines: /**
 * 「lines」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @returns 「lines」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number) => text('app.status.lines', { count }),

                /**
                 * 「textCharacters」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @returns 「textCharacters」が生成した言語別の表示文言またはメッセージを返します。
                 */
                textCharacters: /**
 * 「textCharacters」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @returns 「textCharacters」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number) => text('app.status.textCharacters', { count }),

                /**
                 * 「markdownCharacters」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @returns 「markdownCharacters」が生成した言語別の表示文言またはメッセージを返します。
                 */
                markdownCharacters: /**
 * 「markdownCharacters」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @returns 「markdownCharacters」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number) => text('app.status.markdownCharacters', { count }),

                /**
                 * 「zoom」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param percent 「percent」は、「zoom」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「zoom」が生成した言語別の表示文言またはメッセージを返します。
                 */
                zoom: /**
 * 「zoom」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param percent 「percent」は、「zoom」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「zoom」が生成した言語別の表示文言またはメッセージを返します。
 */ (percent: number) => text('app.status.zoom', { percent }),
                syncing: raw.app.status.syncing,
                synced: raw.app.status.synced
            },
            inspector: raw.app.inspector,
            link: raw.app.link,
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

                /**
                 * 「rowColumnLimit」は、処理時間、入力サイズ、または対象数を制限する境界値です。
                 * @param rows 「rows」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
                 * @param columns 「columns」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
                 * @returns 「rowColumnLimit」が生成した言語別の表示文言またはメッセージを返します。
                 */
                rowColumnLimit: /**
 * 「rowColumnLimit」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param rows 「rows」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
 * @param columns 「columns」は、「rowColumnLimit」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「rowColumnLimit」が生成した言語別の表示文言またはメッセージを返します。
 */ (rows: number, columns: number) => text('app.tableEditor.rowColumnLimit', { rows, columns }),
                copied: raw.app.tableEditor.copied,
                sourceEditorClosed: raw.app.tableEditor.sourceEditorClosed,
                documentChanged: raw.app.tableEditor.documentChanged,
                resizeColumn: raw.app.tableEditor.resizeColumn,
                resizeRow: raw.app.tableEditor.resizeRow,
                resizeEditor: raw.app.tableEditor.resizeEditor
            },
            help: raw.app.help,
            toast: {

                /**
                 * 「imagesSaved」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @returns 「imagesSaved」が生成した言語別の表示文言またはメッセージを返します。
                 */
                imagesSaved: /**
 * 「imagesSaved」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @returns 「imagesSaved」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number) => text('app.toast.imagesSaved', { count }),

                /**
                 * 「pdfResourceWarnings」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @param detail 「detail」は、「pdfResourceWarnings」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「pdfResourceWarnings」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pdfResourceWarnings: /**
 * 「pdfResourceWarnings」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @param detail 「detail」は、「pdfResourceWarnings」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「pdfResourceWarnings」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number, detail: string) => text('app.toast.pdfResourceWarnings', { count, detail }),

                /**
                 * 「preflightSummary」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param errors 「errors」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @param warnings 「warnings」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @param infos 「infos」は、「preflightSummary」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「preflightSummary」が生成した言語別の表示文言またはメッセージを返します。
                 */
                preflightSummary: /**
 * 「preflightSummary」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param errors 「errors」は、「preflightSummary」が言語別メッセージで処理する対象を特定する入力です。
 * @param warnings 「warnings」は、「preflightSummary」が言語別メッセージで処理する対象を特定する入力です。
 * @param infos 「infos」は、「preflightSummary」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「preflightSummary」が生成した言語別の表示文言またはメッセージを返します。
 */ (errors: number, warnings: number, infos: number) => text('app.toast.preflightSummary', { errors, warnings, infos }),

                /**
                 * 「imageSaveFailed」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「imageSaveFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「imageSaveFailed」が生成した言語別の表示文言またはメッセージを返します。
                 */
                imageSaveFailed: /**
 * 「imageSaveFailed」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「imageSaveFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「imageSaveFailed」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail: string) => text('app.toast.imageSaveFailed', { detail }),

                /**
                 * 「pdfExportFailed」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「pdfExportFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「pdfExportFailed」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pdfExportFailed: /**
 * 「pdfExportFailed」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「pdfExportFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「pdfExportFailed」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail: string) => text('app.toast.pdfExportFailed', { detail }),

                /**
                 * 「resourceCheckFailed」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「resourceCheckFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @param duringPdf 「duringPdf」は、「resourceCheckFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「resourceCheckFailed」が生成した言語別の表示文言またはメッセージを返します。
                 */
                resourceCheckFailed: /**
 * 「resourceCheckFailed」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「resourceCheckFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @param duringPdf 「duringPdf」は、「resourceCheckFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「resourceCheckFailed」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail: string, duringPdf: boolean) => text('app.toast.resourceCheckFailed', { prefix: duringPdf ? `${raw.host.pdfProgress} ` : '', detail }),

                /**
                 * 「operationFailed」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「operationFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「operationFailed」が生成した言語別の表示文言またはメッセージを返します。
                 */
                operationFailed: /**
 * 「operationFailed」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「operationFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「operationFailed」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail: string) => text('app.toast.operationFailed', { detail }),

                /**
                 * 「pdfExported」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
                 * @returns 「pdfExported」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pdfExported: /**
 * 「pdfExported」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
 * @returns 「pdfExported」が生成した言語別の表示文言またはメッセージを返します。
 */ (path: string) => text('app.toast.pdfExported', { path }),

                /**
                 * 「htmlExported」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @returns 「htmlExported」が生成した言語別の表示文言またはメッセージを返します。
                 */
                htmlExported: /**
 * 「htmlExported」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @returns 「htmlExported」が生成した言語別の表示文言またはメッセージを返します。
 */ (path: string, count: number) => text('app.toast.htmlExported', { path, count }),

                /**
                 * 「htmlExportFailed」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「htmlExportFailed」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「htmlExportFailed」が生成した言語別の表示文言またはメッセージを返します。
                 */
                htmlExportFailed: /**
 * 「htmlExportFailed」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「htmlExportFailed」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「htmlExportFailed」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail: string) => text('app.toast.htmlExportFailed', { detail }),
                tableCellRequired: raw.app.toast.tableCellRequired,
                cannotPasteTsv: raw.app.toast.cannotPasteTsv,
                tableCopied: raw.app.toast.tableCopied,

                /**
                 * 「cannotCopyTsv」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「cannotCopyTsv」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 条件を満たすかどうかを示す真偽値を返します。
                 */
                cannotCopyTsv: /**
 * 「cannotCopyTsv」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「cannotCopyTsv」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 条件を満たすかどうかを示す真偽値を返します。
 */ (detail?: string) => detail ? text('app.toast.cannotCopyTsv', { detail }) : raw.app.toast.cannotCopyTsvEmpty,
                workspaceTrustRequired: raw.app.toast.workspaceTrustRequired,

                /**
                 * 「pdfStartedWithDiagnostics」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param count 処理対象の件数、容量、または上限を表す数値です。
                 * @param detail 「detail」は、「pdfStartedWithDiagnostics」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「pdfStartedWithDiagnostics」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pdfStartedWithDiagnostics: /**
 * 「pdfStartedWithDiagnostics」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @param detail 「detail」は、「pdfStartedWithDiagnostics」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「pdfStartedWithDiagnostics」が生成した言語別の表示文言またはメッセージを返します。
 */ (count: number, detail: string) => text('app.toast.pdfStartedWithDiagnostics', { count, detail }),

                /**
                 * 「pdfFallbackToMarkdown」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param detail 「detail」は、「pdfFallbackToMarkdown」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「pdfFallbackToMarkdown」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pdfFallbackToMarkdown: /**
 * 「pdfFallbackToMarkdown」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param detail 「detail」は、「pdfFallbackToMarkdown」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「pdfFallbackToMarkdown」が生成した言語別の表示文言またはメッセージを返します。
 */ (detail?: string) => text('app.toast.pdfFallbackToMarkdown', { prefix: detail ? `${detail} ` : '' })
            },
            errors: {
                ackMismatch: raw.app.errors.ackMismatch,

                /**
                 * 「pendingOperationChain」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param opId 「opId」は、「pendingOperationChain」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「pendingOperationChain」が生成した言語別の表示文言またはメッセージを返します。
                 */
                pendingOperationChain: /**
 * 「pendingOperationChain」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param opId 「opId」は、「pendingOperationChain」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「pendingOperationChain」が生成した言語別の表示文言またはメッセージを返します。
 */ (opId: string) => text('app.errors.pendingOperationChain', { opId }),
                clipboardUnavailable: raw.app.errors.clipboardUnavailable,
                bmpConversion: raw.app.errors.bmpConversion,

                /**
                 * 「imageSize」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
                 * @param maxSizeMb 「maxSizeMb」は、「imageSize」が言語別メッセージ処理の処理対象を特定する入力です。
                 * @returns 「imageSize」が生成した言語別の表示文言またはメッセージを返します。
                 */
                imageSize: /**
 * 「imageSize」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param maxSizeMb 「maxSizeMb」は、「imageSize」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「imageSize」が生成した言語別の表示文言またはメッセージを返します。
 */ (maxSizeMb: number) => text('app.errors.imageSize', { maxSizeMb })
            }
        },
        renderer: raw.renderer,
        diagnostics: {

            /**
             * 「unclosedFence」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param marker 「marker」は、「unclosedFence」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「unclosedFence」が生成した言語別の表示文言またはメッセージを返します。
             */
            unclosedFence: /**
 * 「unclosedFence」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param marker 「marker」は、「unclosedFence」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「unclosedFence」が生成した言語別の表示文言またはメッセージを返します。
 */ (marker: string) => text('diagnostics.unclosedFence', { marker }),

            /**
             * 見出しを作成または組み立てます。
             * @param id 「id」は、「duplicateHeading」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「duplicateHeading」が生成した言語別の表示文言またはメッセージを返します。
             */
            duplicateHeading: /**
 * 「duplicateHeading」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param id 「id」は、「duplicateHeading」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「duplicateHeading」が生成した言語別の表示文言またはメッセージを返します。
 */ (id: string) => text('diagnostics.duplicateHeading', { id }),
            invalidTableSeparator: raw.diagnostics.invalidTableSeparator,
            emptyImageAlt: raw.diagnostics.emptyImageAlt,

            /**
             * 「localImageCheck」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param source 処理対象のソースです。
             * @returns 「localImageCheck」が生成した言語別の表示文言またはメッセージを返します。
             */
            localImageCheck: /**
 * 「localImageCheck」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param source 言語別メッセージで解析・編集・変換する本文またはデータです。
 * @returns 「localImageCheck」が生成した言語別の表示文言またはメッセージを返します。
 */ (source: string) => text('diagnostics.localImageCheck', { source }),
            emptyTableHeader: raw.diagnostics.emptyTableHeader,

            /**
             * 「tableColumnMismatch」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param header 「header」は、「tableColumnMismatch」が言語別メッセージ処理の処理対象を特定する入力です。
             * @param count 処理対象の件数、容量、または上限を表す数値です。
             * @param kind 対象の種別または処理経路を選択する識別値です。
             * @returns 「tableColumnMismatch」が生成した言語別の表示文言またはメッセージを返します。
             */
            tableColumnMismatch: /**
 * 「tableColumnMismatch」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param header 「header」は、「tableColumnMismatch」が言語別メッセージで処理する対象を特定する入力です。
 * @param count 処理対象を特定する位置、範囲、または数量です。
 * @param kind 処理対象の種別または画面モードを表す識別値です。
 * @returns 「tableColumnMismatch」が生成した言語別の表示文言またはメッセージを返します。
 */ (header: number, count: number, kind: 'separator' | 'body') => text('diagnostics.tableColumnMismatch', { header, count, kind: raw.diagnostics.tableKind[kind] }),

            /**
             * 「missingReference」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param label 「label」は、「missingReference」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「missingReference」が生成した言語別の表示文言またはメッセージを返します。
             */
            missingReference: /**
 * 「missingReference」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param label 「label」は、「missingReference」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「missingReference」が生成した言語別の表示文言またはメッセージを返します。
 */ (label: string) => text('diagnostics.missingReference', { label }),

            /**
             * 「localResource」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param kind 対象の種別または処理経路を選択する識別値です。
             * @param missing 「missing」は、「localResource」が言語別メッセージ処理の処理対象を特定する入力です。
             * @param source 処理対象のソースです。
             * @param detail 「detail」は、「localResource」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「localResource」が生成した言語別の表示文言またはメッセージを返します。
             */
            localResource: /**
 * 「localResource」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param kind 処理対象の種別または画面モードを表す識別値です。
 * @param missing 「missing」は、「localResource」が言語別メッセージで処理する対象を特定する入力です。
 * @param source 言語別メッセージで解析・編集・変換する本文またはデータです。
 * @param detail 「detail」は、「localResource」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「localResource」が生成した言語別の表示文言またはメッセージを返します。
 */ (kind: 'image' | 'link', missing: boolean, source: string, detail: string) => {
                const suffix = kind === 'image' ? (missing ? 'imageMissing' : 'imageCheckFailed') : (missing ? 'linkMissing' : 'linkCheckFailed');
                return text(`diagnostics.localResource.${suffix}`, { source, detail });
            }
        },
        host: {
            pdfTrustRequired: raw.host.pdfTrustRequired,
            pdfProgress: raw.host.pdfProgress,

            /**
             * 「pdfExported」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
             * @returns 「pdfExported」が生成した言語別の表示文言またはメッセージを返します。
             */
            pdfExported: /**
 * 「pdfExported」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
 * @returns 「pdfExported」が生成した言語別の表示文言またはメッセージを返します。
 */ (path: string) => text('host.pdfExported', { path }),
            htmlTrustRequired: raw.host.htmlTrustRequired,
            htmlProgress: raw.host.htmlProgress,

            /**
             * 「htmlExported」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
             * @returns 「htmlExported」が生成した言語別の表示文言またはメッセージを返します。
             */
            htmlExported: /**
 * 「htmlExported」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param path 言語別メッセージで読み込みまたは出力するリソースの場所です。
 * @returns 「htmlExported」が生成した言語別の表示文言またはメッセージを返します。
 */ (path: string) => text('host.htmlExported', { path }),
            htmlRenderTimeout: raw.host.htmlRenderTimeout,
            open: raw.host.open,
            saveCanceled: raw.host.saveCanceled,
            imageDocumentMustBeSaved: raw.host.imageDocumentMustBeSaved,

            /**
             * 「unsupportedImage」は、関連する入力を検証し、呼び出し元が利用する処理結果を生成します。
             * @param mime 「mime」は、「unsupportedImage」が言語別メッセージ処理の処理対象を特定する入力です。
             * @returns 「unsupportedImage」が生成した言語別の表示文言またはメッセージを返します。
             */
            unsupportedImage: /**
 * 「unsupportedImage」は、登録先へ渡された入力を検証・変換し、必要な処理結果を生成します。
 * @param mime 「mime」は、「unsupportedImage」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「unsupportedImage」が生成した言語別の表示文言またはメッセージを返します。
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
 * get・messagesを取得または解決します。
 * @param language 表示文言の解決に使用する言語コードまたはロケールです。
 * @param vscodeLanguage 「vscodeLanguage」は、「getMessages」が言語別メッセージで処理する対象を特定する入力です。
 * @returns 「getMessages」が読み取りまたは正規化した結果を返します。
 */
export function getMessages(language: SupportedLanguage | string | undefined, vscodeLanguage?: string): Messages {
    return MESSAGE_CATALOG[resolveLanguage(language, vscodeLanguage)];
}

/** 「MESSAGE_CATALOG」は、機能間で参照する対応表または定義です。 */
/** 正規化済み言語ごとのメッセージを保持し、表示文言を一貫して解決する共有カタログ。 */
export const MESSAGE_CATALOG: Record<SupportedLanguage, Messages> = Object.fromEntries(
    SUPPORTED_LANGUAGES.map(
    /**
 * 「language」を変換し、変換後の要素を返すコールバックです。
     * @param language 表示文言の解決に使用する言語コードまたはロケールです。
     * @returns 入力要素から生成した変換後の値を返します。
     */
    (language) => [language, createMessages(language)])
) as Record<SupportedLanguage, Messages>;
