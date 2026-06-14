"use strict";

const { EXPORT_PAGE_PATH } = globalThis.TabPackConstants;
const { createTab } = globalThis.TabPackBrowserApi;

document.addEventListener("DOMContentLoaded", () => {
  const openButton = document.getElementById("openExport");

  openButton.addEventListener("click", () => {
    createTab({
      url: chrome.runtime.getURL(EXPORT_PAGE_PATH)
    }).catch((error) => {
      console.error("Failed to open TabPack export page.", error);
    });
  });
});
