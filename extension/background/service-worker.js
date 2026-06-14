// @ts-check
"use strict";

importScripts(
  "../shared/constants.js",
  "../shared/browser-api.js",
  "../export/page-serializer.js"
);

const { RUN_SERIALIZER_IN_TAB_MESSAGE } = globalThis.TabPackConstants;
const { executeScript } = globalThis.TabPackBrowserApi;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== RUN_SERIALIZER_IN_TAB_MESSAGE) {
    return false;
  }

  runSerializerInTab(message.tabId, message.options || {})
    .then((result) => {
      sendResponse({
        ok: true,
        result
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

  return true;
});

function runSerializerInTab(tabId, options) {
  if (typeof tabId !== "number") {
    return Promise.reject(new Error("The background serializer received an invalid tab ID."));
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return Promise.reject(new Error("The scripting API is not available in the extension background service worker."));
  }

  return executeScript({
    target: {
      tabId
    },
    func: serializeCompleteHtmlInPage,
    args: [
      options
    ]
  }).then((results) => {
    const firstResult = Array.isArray(results) ? results[0] : null;
    return firstResult ? firstResult.result : null;
  });
}
