"use strict";

const { EXPORT_PAGE_PATH } = globalThis.TabPackConstants;
const { createTab, queryTabs } = globalThis.TabPackBrowserApi;
const ExportHelpers = globalThis.TabPackExportHelpers;

const NO_GROUP_ID = chrome.tabGroups && typeof chrome.tabGroups.TAB_GROUP_ID_NONE === "number"
  ? chrome.tabGroups.TAB_GROUP_ID_NONE
  : -1;

document.addEventListener("DOMContentLoaded", () => {
  const openButton = document.getElementById("openExport");
  refreshSummary();

  openButton.addEventListener("click", () => {
    createTab({
      url: chrome.runtime.getURL(EXPORT_PAGE_PATH)
    }).catch((error) => {
      console.error("Failed to open TabPack export page.", error);
    });
  });
});

function refreshSummary() {
  queryTabs({ currentWindow: true }).then((tabs) => {
    const summary = ExportHelpers.summarizeTabs(tabs, {
      noGroupId: NO_GROUP_ID
    });

    setText("groupCount", summary.groupCount);
    setText("eligibleCount", summary.eligibleGroupedTabs);
    setText("skippedCount", summary.skippedTabs);

    const detail = document.getElementById("summaryDetail");
    detail.textContent = `${summary.ungroupedTabs} ungrouped and ${summary.unsupportedGroupedTabs} unsupported tab(s) would be skipped.`;
  }).catch((error) => {
    setText("groupCount", "!");
    setText("eligibleCount", "!");
    setText("skippedCount", "!");
    document.getElementById("summaryDetail").textContent = "Could not read the current window summary.";
    console.error("Failed to summarize tabs.", error);
  });
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}
