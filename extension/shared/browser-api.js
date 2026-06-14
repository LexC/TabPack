"use strict";

(function exposeBrowserApi(root) {
  function getRuntimeErrorMessage() {
    const error = root.chrome && root.chrome.runtime
      ? root.chrome.runtime.lastError
      : null;
    return error && error.message ? error.message : null;
  }

  function createTab(options) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(options, (tab) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(tab);
      });
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(Array.isArray(tabs) ? tabs : []);
      });
    });
  }

  function getTabGroup(groupId) {
    return new Promise((resolve, reject) => {
      chrome.tabGroups.get(groupId, (group) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(group);
      });
    });
  }

  function download(options) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(options, (downloadId) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(downloadId);
      });
    });
  }

  function executeScript(options) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript(options, (results) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(results);
      });
    });
  }

  function executeLegacyTabScript(tabId, options) {
    return new Promise((resolve, reject) => {
      chrome.tabs.executeScript(tabId, options, (results) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(results);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(response);
      });
    });
  }

  function saveAsMHTML(options) {
    return new Promise((resolve, reject) => {
      chrome.pageCapture.saveAsMHTML(options, (blob) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(blob);
      });
    });
  }

  root.TabPackBrowserApi = Object.freeze({
    createTab,
    queryTabs,
    getTabGroup,
    download,
    executeScript,
    executeLegacyTabScript,
    sendRuntimeMessage,
    saveAsMHTML,
    getRuntimeErrorMessage
  });
})(globalThis);
