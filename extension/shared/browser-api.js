// @ts-check
"use strict";

(function exposeBrowserApi(root) {
  // Centralize chrome.runtime.lastError handling so callers can use promises.
  function getRuntimeErrorMessage() {
    const error = root.chrome && root.chrome.runtime
      ? root.chrome.runtime.lastError
      : null;
    return error && error.message ? error.message : null;
  }

  /** @param {chrome.tabs.CreateProperties} options */
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

  /** @param {chrome.tabs.QueryInfo} queryInfo */
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

  /** @param {number} groupId */
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

  /** @param {chrome.downloads.DownloadOptions} options */
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

  /** @param {any} options */
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

  /** @param {unknown} message */
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

  /** @param {chrome.pageCapture.SaveDetails} options */
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

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      if (!chrome.storage || !chrome.storage.local) {
        resolve({});
        return;
      }

      chrome.storage.local.get(keys, (items) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(items || {});
      });
    });
  }

  function storageSet(items) {
    return new Promise((resolve, reject) => {
      if (!chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      chrome.storage.local.set(items, () => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve();
      });
    });
  }

  function permissionsContains(permissions) {
    return new Promise((resolve, reject) => {
      if (!chrome.permissions || typeof chrome.permissions.contains !== "function") {
        resolve(false);
        return;
      }

      chrome.permissions.contains(permissions, (result) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(Boolean(result));
      });
    });
  }

  function permissionsRequest(permissions) {
    return new Promise((resolve, reject) => {
      if (!chrome.permissions || typeof chrome.permissions.request !== "function") {
        resolve(false);
        return;
      }

      chrome.permissions.request(permissions, (granted) => {
        const errorMessage = getRuntimeErrorMessage();
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        resolve(Boolean(granted));
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
    storageGet,
    storageSet,
    permissionsContains,
    permissionsRequest,
    getRuntimeErrorMessage
  });
})(globalThis);
