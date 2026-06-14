"use strict";

(function exposeConstants(root) {
  root.TabPackConstants = Object.freeze({
    EXPORT_PAGE_PATH: "export/export.html",
    ROOT_FOLDER_NAME: "TabPack",
    MAX_FOLDER_NAME_LENGTH: 80,
    MAX_ASSET_FILE_NAME_LENGTH: 120,
    HTML_PAGE_MODE: "html",
    HTML_LOCAL_ASSET_PATHS_MODE: "html-local",
    HTML_RELEVANT_ASSETS_MODE: "html-relevant",
    HTML_ALL_ASSETS_MODE: "html-all",
    CSV_MODE: "csv",
    MHTML_MODE: "mhtml",
    HTML_ASSET_NONE: "none",
    HTML_ASSET_RELEVANT: "relevant",
    HTML_ASSET_ALL: "all",
    CSV_FILE_NAME: "tab-groups.csv",
    EXPORT_REPORT_FILE_NAME: "tabpack-export-report.json",
    RUN_SERIALIZER_IN_TAB_MESSAGE: "TabPack.runSerializerInTab"
  });
})(globalThis);
