// @ts-check
"use strict";

/**
 * Destination and remembered-folder handling for the export page.
 * @param {typeof globalThis} root
 */
(function exposeExportDestination(root) {
  const DIRECTORY_DB_NAME = "TabPackDirectoryHandles";
  const DIRECTORY_DB_VERSION = 1;
  const DIRECTORY_STORE_NAME = "handles";
  const DIRECTORY_HANDLE_KEY = "outputDirectory";

  /**
   * Build the destination module around the export page's shared state.
   *
   * This module is intentionally the only place that knows how selected folder
   * handles are chosen, remembered, permission-checked, and downgraded to the
   * Downloads fallback. The writer module can then assume "selected folder" means
   * a writable File System Access handle has already been verified.
   *
   * @param {TabPackExportContext} context
   */
  function createExportDestination(context) {
    const { state, elements } = context;
    const { ROOT_FOLDER_NAME } = context.constants;
    const getErrorMessage = context.getErrorMessage;
    const isUserCancellation = context.isUserCancellation;
    const saveExportPreferences = context.saveExportPreferences;
    const refreshPlanDisplay = context.refreshPlanDisplay;

    function updateExportAvailability() {
      context.renderer.updateExportAvailability();
    }

    /** @param {string} message @param {TabPackLogLevel=} level */
    function logMessage(message, level = "info") {
      context.renderer.logMessage(message, level);
    }

    /**
     * Initialize destination controls from browser capability, not preference.
     *
     * Some Chromium extension contexts expose `showDirectoryPicker()` and some do
     * not. When it is missing, TabPack keeps the fallback explicit instead of
     * silently switching to Downloads.
     */
    function initializeDestinationUi() {
      if (!supportsFileSystemAccess()) {
        elements.chooseFolderButton.disabled = true;
        elements.selectedFolderText.textContent =
          "User-selected folder export is unavailable because this browser context does not expose showDirectoryPicker().";
        elements.selectedFolderText.className = "status warning";
        revealDownloadsFallback("File System Access API folder selection is unavailable here.");
        logMessage("File System Access API is unavailable. Downloads fallback can be selected explicitly.", "warning");
        return;
      }

      elements.selectedFolderText.textContent = "No output folder selected.";
      elements.selectedFolderText.className = "status";
    }

    /**
     * Restore the persisted File System Access directory handle when the browser
     * still considers it valid and writable.
     *
     * Directory handles are stored in IndexedDB because `chrome.storage` cannot
     * persist these structured-clone objects. Permission may still expire between
     * sessions, so restore never prompts; it only reuses already-granted access.
     */
    async function restoreRememberedOutputFolder() {
      if (!supportsFileSystemAccess() || typeof indexedDB === "undefined") {
        return;
      }

      try {
        const directoryHandle = await readRememberedDirectoryHandle();
        if (!directoryHandle) {
          return;
        }

        const currentPermission = typeof directoryHandle.queryPermission === "function"
          ? await directoryHandle.queryPermission({ mode: "readwrite" })
          : "granted";

        if (currentPermission !== "granted") {
          elements.selectedFolderText.textContent = "Saved folder needs permission again. Choose folder.";
          elements.selectedFolderText.className = "status warning";
          logMessage("Remembered output folder found, but write permission is not currently granted.", "warning");
          return;
        }

        state.selectedDirectoryHandle = directoryHandle;
        state.selectedDirectoryWritable = true;
        renderSelectedDirectoryStatus(directoryHandle);
        logMessage(`Restored remembered output folder name: ${directoryHandle.name || "chosen folder"}.`, "success");
      } catch (error) {
        logMessage(`Could not restore remembered output folder: ${getErrorMessage(error)}`, "warning");
      }
    }

    /**
     * Render only the folder name exposed by the browser.
     *
     * The File System Access API deliberately hides the absolute host path from
     * extension pages, so UI and logs must not imply we know the full location.
     */
    function renderSelectedDirectoryStatus(directoryHandle, label = "Current folder") {
      elements.selectedFolderText.textContent = `${label}: `;

      const folderName = document.createElement("span");
      folderName.className = "folder-name";
      folderName.textContent = directoryHandle.name || "chosen folder";
      elements.selectedFolderText.append(folderName);
      elements.selectedFolderText.className = "status good";
    }

    function supportsFileSystemAccess() {
      return typeof window.showDirectoryPicker === "function";
    }

    /**
     * Let the user choose a writable destination and remember it best-effort.
     *
     * A failed remember operation should not block the current export session:
     * current write access matters more than future convenience.
     */
    async function chooseOutputFolder() {
      if (!supportsFileSystemAccess()) {
        revealDownloadsFallback("File System Access API folder selection is unavailable here.");
        updateExportAvailability();
        return;
      }

      try {
        const directoryHandle = await window.showDirectoryPicker({
          mode: "readwrite"
        });

        const hasPermission = await verifyDirectoryPermission(directoryHandle);
        if (!hasPermission) {
          throw new Error("Read/write permission was denied for the selected folder.");
        }

        state.selectedDirectoryHandle = directoryHandle;
        state.selectedDirectoryWritable = true;
        elements.useDownloadsFallback.checked = false;
        renderSelectedDirectoryStatus(directoryHandle);
        saveExportPreferences();
        saveRememberedDirectoryHandle(directoryHandle).catch((error) => {
          logMessage(`Could not remember the selected output folder: ${getErrorMessage(error)}`, "warning");
        });

        logMessage(`Selected output folder name: ${directoryHandle.name || "chosen folder"}. Full path is not exposed to extension pages.`, "success");
      } catch (error) {
        state.selectedDirectoryHandle = null;
        state.selectedDirectoryWritable = false;

        if (isUserCancellation(error)) {
          elements.selectedFolderText.textContent = "Folder selection canceled.";
          elements.selectedFolderText.className = "status";
          logMessage("Folder selection canceled by user.", "warning");
        } else {
          elements.selectedFolderText.textContent = "Selected-folder export is unavailable until another folder is chosen.";
          elements.selectedFolderText.className = "status error";
          revealDownloadsFallback(`Selected-folder export failed: ${getErrorMessage(error)}`);
          logMessage(`Folder selection failed: ${getErrorMessage(error)}`, "error");
        }
      } finally {
        updateExportAvailability();
        refreshPlanDisplay();
      }
    }

    /**
     * Query before requesting permission so reopening the page does not create an
     * unnecessary prompt. Older implementations may omit both methods; in that
     * case, the handle itself is treated as usable and writes will be the final
     * authority.
     */
    async function verifyDirectoryPermission(directoryHandle) {
      const options = { mode: "readwrite" };

      if (typeof directoryHandle.queryPermission === "function") {
        const currentPermission = await directoryHandle.queryPermission(options);
        if (currentPermission === "granted") {
          return true;
        }
      }

      if (typeof directoryHandle.requestPermission === "function") {
        const requestedPermission = await directoryHandle.requestPermission(options);
        return requestedPermission === "granted";
      }

      return true;
    }

    /**
     * Open the tiny IndexedDB store that keeps the last chosen directory handle.
     * The schema is intentionally one key/value object store so migrations stay
     * simple if browser support changes.
     */
    function openDirectoryDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DIRECTORY_DB_NAME, DIRECTORY_DB_VERSION);

        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
            database.createObjectStore(DIRECTORY_STORE_NAME);
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error || new Error("IndexedDB open failed."));
        };
      });
    }

    /** Persist the selected handle for a future page session when IndexedDB exists. */
    async function saveRememberedDirectoryHandle(directoryHandle) {
      if (typeof indexedDB === "undefined") {
        return;
      }

      const database = await openDirectoryDatabase();
      try {
        await runDirectoryStoreRequest(database, "readwrite", (store) => {
          return store.put(directoryHandle, DIRECTORY_HANDLE_KEY);
        });
      } finally {
        database.close();
      }
    }

    /** Read the last selected handle, or `undefined` when none was persisted. */
    async function readRememberedDirectoryHandle() {
      const database = await openDirectoryDatabase();
      try {
        return await runDirectoryStoreRequest(database, "readonly", (store) => {
          return store.get(DIRECTORY_HANDLE_KEY);
        });
      } finally {
        database.close();
      }
    }

    /**
     * Convert one IndexedDB request into a promise while still surfacing
     * transaction-level failures, which otherwise disappear behind request
     * callbacks.
     */
    function runDirectoryStoreRequest(database, mode, makeRequest) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(DIRECTORY_STORE_NAME, mode);
        const request = makeRequest(transaction.objectStore(DIRECTORY_STORE_NAME));

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error || new Error("IndexedDB request failed."));
        };

        transaction.onerror = () => {
          reject(transaction.error || new Error("IndexedDB transaction failed."));
        };
      });
    }

    /**
     * Make the Downloads fallback visible, but keep it opt-in through the
     * checkbox. This preserves the user's control over where files are written.
     */
    function revealDownloadsFallback(message) {
      elements.fallbackPanel.classList.remove("hidden");
      elements.fallbackMessage.textContent = `${message} Fallback export writes to Downloads/${ROOT_FOLDER_NAME}/.`;
    }

    /**
     * Final guard immediately before selected-folder export begins.
     *
     * Permission can be revoked after scan/preview, so export verifies again and
     * exposes the fallback when the chosen handle is no longer writable.
     */
    async function ensureSelectedDirectoryReady() {
      if (!state.selectedDirectoryHandle) {
        throw new Error("Choose an output folder before exporting.");
      }

      let hasPermission = false;

      try {
        hasPermission = await verifyDirectoryPermission(state.selectedDirectoryHandle);
      } catch (error) {
        state.selectedDirectoryWritable = false;
        revealDownloadsFallback(`Could not verify write permission for the selected folder: ${getErrorMessage(error)}`);
        updateExportAvailability();
        throw error;
      }

      if (!hasPermission) {
        state.selectedDirectoryWritable = false;
        revealDownloadsFallback("Read/write permission was denied for the selected folder.");
        updateExportAvailability();
        throw new Error("Read/write permission was denied for the selected folder.");
      }

      state.selectedDirectoryWritable = true;
    }

    return Object.freeze({
      initializeDestinationUi,
      restoreRememberedOutputFolder,
      chooseOutputFolder,
      revealDownloadsFallback,
      ensureSelectedDirectoryReady,
      supportsFileSystemAccess
    });
  }

  root.TabPackExportDestination = Object.freeze({
    create: createExportDestination
  });
})(globalThis);
