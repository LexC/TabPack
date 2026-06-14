"use strict";

const {
  ROOT_FOLDER_NAME,
  MAX_FOLDER_NAME_LENGTH,
  MAX_ASSET_FILE_NAME_LENGTH,
  HTML_PAGE_MODE,
  HTML_LOCAL_ASSET_PATHS_MODE,
  HTML_RELEVANT_ASSETS_MODE,
  HTML_ALL_ASSETS_MODE,
  CSV_MODE,
  MHTML_MODE,
  HTML_ASSET_NONE,
  HTML_ASSET_RELEVANT,
  HTML_ASSET_ALL,
  CSV_FILE_NAME,
  RUN_SERIALIZER_IN_TAB_MESSAGE
} = globalThis.TabPackConstants;

const {
  queryTabs,
  getTabGroup: getTabGroupById,
  download,
  executeScript,
  executeLegacyTabScript,
  sendRuntimeMessage,
  saveAsMHTML,
  storageGet,
  storageSet,
  permissionsContains,
  permissionsRequest
} = globalThis.TabPackBrowserApi;

const ExportHelpers = globalThis.TabPackExportHelpers;
const EXPORT_PREFERENCES_KEY = "exportPreferences";
const DIRECTORY_DB_NAME = "TabPackDirectoryHandles";
const DIRECTORY_DB_VERSION = 1;
const DIRECTORY_STORE_NAME = "handles";
const DIRECTORY_HANDLE_KEY = "outputDirectory";

const NO_GROUP_ID = chrome.tabGroups && typeof chrome.tabGroups.TAB_GROUP_ID_NONE === "number"
  ? chrome.tabGroups.TAB_GROUP_ID_NONE
  : -1;

const state = {
  selectedDirectoryHandle: null,
  selectedDirectoryWritable: false,
  exportPlan: null,
  skippedTabs: [],
  isExporting: false,
  stopRequested: false,
  exportAbortController: null,
  preferencesLoaded: false,
  optionalHostPermissionsGranted: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initializeExportPage().catch((error) => {
    logMessage(`TabPack initialization warning: ${getErrorMessage(error)}`, "warning");
    initializeDestinationUi();
    resetCounters();
    setExportProgressIdle("Export progress will appear here when an export starts.");
    updateExportAvailability();
  });
});

function bindElements() {
  elements.scanButton = document.getElementById("scanButton");
  elements.exportButton = document.getElementById("exportButton");
  elements.stopExportButton = document.getElementById("stopExportButton");
  elements.chooseFolderButton = document.getElementById("chooseFolderButton");
  elements.selectedFolderText = document.getElementById("selectedFolderText");
  elements.createRootFolder = document.getElementById("createRootFolder");
  elements.fallbackPanel = document.getElementById("fallbackPanel");
  elements.fallbackMessage = document.getElementById("fallbackMessage");
  elements.useDownloadsFallback = document.getElementById("useDownloadsFallback");
  elements.conflictBehavior = document.getElementById("conflictBehavior");
  elements.conflictButtons = Array.from(document.querySelectorAll("[data-conflict-value]"));
  elements.preview = document.getElementById("preview");
  elements.skippedTabs = document.getElementById("skippedTabs");
  elements.skippedSummaryText = document.getElementById("skippedSummaryText");
  elements.exportProgressPanel = document.getElementById("exportProgressPanel");
  elements.exportProgressPercent = document.getElementById("exportProgressPercent");
  elements.exportProgressBar = document.getElementById("exportProgressBar");
  elements.exportProgressTrack = elements.exportProgressBar ? elements.exportProgressBar.parentElement : null;
  elements.exportProgressDetail = document.getElementById("exportProgressDetail");
  elements.progressLog = document.getElementById("progressLog");
  elements.eligibleCount = document.getElementById("eligibleCount");
  elements.skippedCount = document.getElementById("skippedCount");
  elements.successCount = document.getElementById("successCount");
  elements.failureCount = document.getElementById("failureCount");
  elements.selectedCount = document.getElementById("selectedCount");
  elements.modeInputs = Array.from(document.querySelectorAll("input[name='exportMode']"));
}

function bindEvents() {
  elements.scanButton.addEventListener("click", scanGroupedTabs);
  elements.exportButton.addEventListener("click", exportGroupedTabs);
  elements.stopExportButton.addEventListener("click", stopExport);
  elements.chooseFolderButton.addEventListener("click", chooseOutputFolder);
  elements.createRootFolder.addEventListener("change", () => {
    saveExportPreferences();
    refreshPlanDisplay();
  });
  elements.useDownloadsFallback.addEventListener("change", () => {
    saveExportPreferences();
    updateExportAvailability();
    refreshPlanDisplay();
  });

  for (const input of elements.modeInputs) {
    input.addEventListener("change", () => {
      saveExportPreferences();
      refreshPlanDisplay();
    });
  }

  for (const button of elements.conflictButtons) {
    button.addEventListener("click", () => {
      setConflictBehavior(button.dataset.conflictValue);
      saveExportPreferences();
    });
  }
}

async function initializeExportPage() {
  await loadExportPreferences();
  refreshOptionalHostPermissionState();
  initializeDestinationUi();
  await restoreRememberedOutputFolder();
  resetCounters();
  setExportProgressIdle("Export progress will appear here when an export starts.");
  updateExportAvailability();
}

function refreshOptionalHostPermissionState() {
  permissionsContains({
    origins: ExportHelpers.getOptionalHostOrigins()
  }).then((granted) => {
    state.optionalHostPermissionsGranted = granted;
  }).catch((_error) => {
    state.optionalHostPermissionsGranted = false;
  });
}

function stopExport() {
  if (!state.isExporting || state.stopRequested) {
    return;
  }

  state.stopRequested = true;
  if (state.exportAbortController) {
    state.exportAbortController.abort();
  }
  updateExportAvailability();
  logMessage("Stop requested. TabPack will stop after the current in-flight browser operation ends.", "warning");
}

function throwIfExportStopped() {
  if (!state.stopRequested) {
    return;
  }

  const error = new Error("Export stopped by user.");
  error.name = "AbortError";
  throw error;
}

function isExportStopError(error) {
  return Boolean(state.stopRequested && error && (
    error.name === "AbortError" ||
    /aborted|cancel|stopped/i.test(getErrorMessage(error))
  ));
}

function setConflictBehavior(value) {
  elements.conflictBehavior.value = value;

  for (const button of elements.conflictButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.conflictValue === value));
  }
}

async function loadExportPreferences() {
  try {
    const items = await storageGet(EXPORT_PREFERENCES_KEY);
    const preferences = items && items[EXPORT_PREFERENCES_KEY] ? items[EXPORT_PREFERENCES_KEY] : {};

    if (isKnownMode(preferences.mode)) {
      for (const input of elements.modeInputs) {
        input.checked = input.value === preferences.mode;
      }
    }

    if (preferences.conflictBehavior === "overwrite" || preferences.conflictBehavior === "uniquify") {
      setConflictBehavior(preferences.conflictBehavior);
    }

    if (typeof preferences.createRootFolder === "boolean") {
      elements.createRootFolder.checked = preferences.createRootFolder;
    }

    if (typeof preferences.useDownloadsFallback === "boolean") {
      elements.useDownloadsFallback.checked = preferences.useDownloadsFallback;
    }

  } catch (error) {
    logMessage(`Could not load saved export preferences: ${getErrorMessage(error)}`, "warning");
  } finally {
    state.preferencesLoaded = true;
  }
}

function saveExportPreferences() {
  if (!state.preferencesLoaded) {
    return;
  }

  storageSet({
    [EXPORT_PREFERENCES_KEY]: {
      mode: getSelectedMode(),
      conflictBehavior: elements.conflictBehavior.value,
      createRootFolder: elements.createRootFolder.checked,
      useDownloadsFallback: elements.useDownloadsFallback.checked
    }
  }).catch((error) => {
    logMessage(`Could not save export preferences: ${getErrorMessage(error)}`, "warning");
  });
}

function isKnownMode(mode) {
  return mode === HTML_PAGE_MODE ||
    mode === HTML_LOCAL_ASSET_PATHS_MODE ||
    mode === HTML_RELEVANT_ASSETS_MODE ||
    mode === HTML_ALL_ASSETS_MODE ||
    mode === MHTML_MODE ||
    mode === CSV_MODE;
}

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
      elements.selectedFolderText.textContent = "A remembered output folder exists, but write permission must be granted again with Choose output folder.";
      elements.selectedFolderText.className = "status warning";
      logMessage("Remembered output folder found, but write permission is not currently granted.", "warning");
      return;
    }

    state.selectedDirectoryHandle = directoryHandle;
    state.selectedDirectoryWritable = true;
    renderSelectedDirectoryStatus(directoryHandle, "Remembered folder name");
    logMessage(`Restored remembered output folder name: ${directoryHandle.name || "chosen folder"}.`, "success");
  } catch (error) {
    logMessage(`Could not restore remembered output folder: ${getErrorMessage(error)}`, "warning");
  }
}

function renderSelectedDirectoryStatus(directoryHandle, label = "Selected folder name") {
  elements.selectedFolderText.textContent = `${label}: `;

  const folderName = document.createElement("span");
  folderName.className = "folder-name";
  folderName.textContent = directoryHandle.name || "chosen folder";
  elements.selectedFolderText.append(folderName);
  elements.selectedFolderText.append(" (full path is not exposed to extension pages)");
  elements.selectedFolderText.className = "status good";
}

function supportsFileSystemAccess() {
  return typeof window.showDirectoryPicker === "function";
}

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

function revealDownloadsFallback(message) {
  elements.fallbackPanel.classList.remove("hidden");
  elements.fallbackMessage.textContent = `${message} Fallback export writes to Downloads/${ROOT_FOLDER_NAME}/.`;
}

async function scanGroupedTabs() {
  elements.scanButton.disabled = true;
  elements.exportButton.disabled = true;
  state.exportPlan = null;
  state.skippedTabs = [];
  setCounter(elements.successCount, 0);
  setCounter(elements.failureCount, 0);
  setExportProgressIdle("Scan in progress. Export progress will appear when an export starts.");
  clearPreview("Scanning grouped tabs...");
  clearSkippedTabs();
  logMessage("Starting scan of the current browser window for grouped HTTP/HTTPS tabs.", "start");

  try {
    const tabs = await queryCurrentWindowTabs();
    const plan = await buildExportPlan(tabs);
    state.exportPlan = plan;
    state.skippedTabs = plan.skippedTabs;
    updateScanCounters(plan);
    renderPreview();
    renderSkippedTabs();

    if (plan.totalEligibleTabs === 0) {
      logMessage("Scan finished. No eligible grouped HTTP/HTTPS tabs were found.", "warning");
    } else {
      logMessage(`Scan finished. ${plan.totalEligibleTabs} eligible grouped tab(s), ${plan.totalSelectedTabs} selected by default, ${plan.skippedTabs.length} skipped.`, "success");
    }
  } catch (error) {
    clearPreview("Scan failed.");
    logMessage(`Scan failed: ${getErrorMessage(error)}`, "error");
  } finally {
    elements.scanButton.disabled = false;
    updateExportAvailability();
  }
}

function queryCurrentWindowTabs() {
  return queryTabs({ currentWindow: true });
}

async function buildExportPlan(tabs) {
  const groupIds = ExportHelpers.collectTabGroupIds(tabs, {
    noGroupId: NO_GROUP_ID
  });
  const groupMetadata = await loadTabGroupMetadata(groupIds);
  return ExportHelpers.buildExportPlanFromTabs(tabs, groupMetadata, getPathOptions());
}

async function loadTabGroupMetadata(groupIds) {
  const groupMetadata = new Map();

  for (const groupId of groupIds) {
    try {
      const group = await getTabGroup(groupId);
      groupMetadata.set(groupId, group);
    } catch (error) {
      logMessage(`Could not read metadata for tab group ${groupId}: ${getErrorMessage(error)}`, "warning");
    }
  }

  return groupMetadata;
}

function getTabGroup(groupId) {
  return getTabGroupById(groupId).then((group) => {
    if (!group) {
      throw new Error(`No metadata returned for group ${groupId}.`);
    }

    return group;
  });
}

function assignUniqueFolderNames(groups) {
  const usedNames = new Set();

  for (const group of groups) {
    const baseName = sanitizeFolderName(group.originalTitle, group.groupId);
    let folderName = baseName;

    if (usedNames.has(folderName.toLowerCase())) {
      folderName = appendGroupSuffix(baseName, group.groupId);
    }

    while (usedNames.has(folderName.toLowerCase())) {
      folderName = appendGroupSuffix(folderName, group.groupId);
    }

    usedNames.add(folderName.toLowerCase());
    group.sanitizedFolderName = folderName;
  }
}

function sanitizeFolderName(input, groupId) {
  const fallbackName = `Group_${groupId}`;
  let sanitized = String(input || fallbackName)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trimStart()
    .replace(/[.\s]+$/g, "");

  if (!sanitized) {
    sanitized = fallbackName;
  }

  if (isReservedWindowsName(sanitized)) {
    sanitized = `${sanitized}_group`;
  }

  sanitized = trimFolderName(sanitized);
  return sanitized || fallbackName;
}

function appendGroupSuffix(baseName, groupId) {
  const suffix = `__group_${groupId}`;
  const maxBaseLength = Math.max(1, MAX_FOLDER_NAME_LENGTH - suffix.length);
  const trimmedBase = trimFolderName(baseName.slice(0, maxBaseLength)) || "Group";
  return `${trimmedBase}${suffix}`;
}

function trimFolderName(folderName) {
  return folderName
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/[.\s]+$/g, "");
}

function isReservedWindowsName(name) {
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name);
}

function isSupportedTabUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function makeSkippedTab(tab, reason) {
  return {
    reason,
    tabId: typeof tab.id === "number" ? tab.id : null,
    groupId: typeof tab.groupId === "number" ? tab.groupId : null,
    tabIndex: typeof tab.index === "number" ? tab.index : null,
    title: tab.title || "(untitled)",
    url: tab.url || "(no URL)"
  };
}

async function exportGroupedTabs() {
  if (!state.exportPlan || state.exportPlan.totalEligibleTabs === 0) {
    logMessage("Export is unavailable until grouped tabs have been scanned.", "warning");
    updateExportAvailability();
    return;
  }

  applyModeAndPaths(state.exportPlan);

  if (state.exportPlan.mode !== CSV_MODE && state.exportPlan.totalSelectedTabs === 0) {
    logMessage("Select at least one grouped HTTP/HTTPS tab before exporting this mode.", "warning");
    updateExportAvailability();
    return;
  }

  try {
    await ensureOptionalHostPermissionsForExport(state.exportPlan);
  } catch (error) {
    logMessage(getErrorMessage(error), "error");
    updateExportAvailability();
    return;
  }

  state.isExporting = true;
  state.stopRequested = false;
  state.exportAbortController = typeof AbortController === "function"
    ? new AbortController()
    : null;
  setCounter(elements.successCount, 0);
  setCounter(elements.failureCount, 0);
  elements.scanButton.disabled = true;
  updateExportAvailability();

  renderPreview();

  const result = {
    success: 0,
    failure: 0,
    assetWarnings: 0,
    completedItems: 0,
    totalItems: state.exportPlan.mode === CSV_MODE ? 1 : state.exportPlan.totalSelectedTabs,
    progressUnit: state.exportPlan.mode === CSV_MODE ? "file" : "page"
  };
  resetExportProgress(result.totalItems, result.progressUnit);

  try {
    if (isDownloadsFallbackSelected()) {
      logMessage(`Starting Downloads fallback export to Downloads/${ROOT_FOLDER_NAME}/.`, "start");
      await exportWithDownloadsFallback(state.exportPlan, result);
    } else {
      await ensureSelectedDirectoryReady();
      logMessage("Starting selected-folder export with the File System Access API.", "start");
      await exportWithFileSystemAccess(state.exportPlan, result);
    }

    const destinationLabel = isDownloadsFallbackSelected()
      ? `Downloads/${ROOT_FOLDER_NAME}/ fallback`
      : "selected output folder";
    const warningText = result.assetWarnings > 0
      ? ` ${result.assetWarnings} asset warning(s).`
      : "";
    if (state.stopRequested) {
      logMessage(`Export stopped by user. ${result.success} succeeded, ${result.failure} failed, ${state.exportPlan.totalDeselectedTabs} deselected, ${state.skippedTabs.length} skipped.${warningText}`, "warning");
      finishExportProgress(result, "stopped");
    } else {
      logMessage(`Export finished to ${destinationLabel}. ${result.success} succeeded, ${result.failure} failed, ${state.exportPlan.totalDeselectedTabs} deselected, ${state.skippedTabs.length} skipped.${warningText}`, result.failure > 0 ? "warning" : "success");
      finishExportProgress(result, result.failure > 0 ? "warning" : "done");
    }
  } catch (error) {
    if (isExportStopError(error)) {
      logMessage(`Export stopped by user. ${result.success} succeeded, ${result.failure} failed, ${state.exportPlan.totalDeselectedTabs} deselected, ${state.skippedTabs.length} skipped.`, "warning");
      finishExportProgress(result, "stopped");
    } else {
      logMessage(`Export stopped before completion: ${getErrorMessage(error)}`, "error");
      finishExportProgress(result, "error");
    }
  } finally {
    state.isExporting = false;
    state.stopRequested = false;
    state.exportAbortController = null;
    elements.scanButton.disabled = false;
    setCounter(elements.successCount, result.success);
    setCounter(elements.failureCount, result.failure);
    updateExportAvailability();
  }
}

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

async function ensureOptionalHostPermissionsForExport(plan) {
  if (!ExportHelpers.modeRequiresHostAccess(plan.mode) || plan.totalSelectedTabs === 0) {
    return;
  }

  if (state.optionalHostPermissionsGranted) {
    return;
  }

  const origins = ExportHelpers.getOptionalHostOrigins();
  logMessage("HTML export needs page access so TabPack can serialize selected HTTP/HTTPS tabs and fetch referenced assets.", "warning");
  const granted = await permissionsRequest({ origins });
  if (!granted) {
    const alreadyGranted = await permissionsContains({ origins });
    if (alreadyGranted) {
      state.optionalHostPermissionsGranted = true;
      return;
    }

    throw new Error("HTML export was canceled because page access permission was not granted.");
  }

  state.optionalHostPermissionsGranted = true;
  logMessage("Page access permission granted for HTML export.", "success");
}

async function exportWithFileSystemAccess(plan, result) {
  throwIfExportStopped();
  const exportRootHandle = await getExportRootDirectory(state.selectedDirectoryHandle);

  if (plan.mode === CSV_MODE) {
    throwIfExportStopped();
    await exportCsvWithFileSystem(exportRootHandle, plan, result);
    return;
  }

  for (const group of plan.groups) {
    throwIfExportStopped();
    if (group.selectedCount === 0) {
      continue;
    }

    let groupDirectoryHandle;

    try {
      groupDirectoryHandle = await exportRootHandle.getDirectoryHandle(group.sanitizedFolderName, {
        create: true
      });
      logMessage(`Opened folder ${group.sanitizedFolderName}.`, "progress");
    } catch (error) {
      const message = `Could not create/open folder ${group.sanitizedFolderName}: ${getErrorMessage(error)}`;
      logMessage(message, "error");
      result.failure += group.selectedCount;
      setCounter(elements.failureCount, result.failure);
      markExportItemsComplete(result, group.selectedCount);
      continue;
    }

    for (const file of group.files) {
      throwIfExportStopped();
      if (!file.selected) {
        continue;
      }

      if (isHtmlSnapshotMode(plan.mode)) {
        await exportHtmlSnapshotWithFileSystem(groupDirectoryHandle, group, file, plan.mode, result);
      } else {
        await exportSingleFileWithFileSystem(groupDirectoryHandle, group, file, plan.mode, result);
      }
    }
  }
}

async function exportSingleFileWithFileSystem(groupDirectoryHandle, group, file, mode, result) {
  try {
    throwIfExportStopped();
    const blob = await createSingleFileBlob(mode, group, file);
    throwIfExportStopped();
    const finalFileName = await resolveFileName(groupDirectoryHandle, file.fileName);
    await writeBlobToDirectory(groupDirectoryHandle, finalFileName, blob);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${group.sanitizedFolderName}/${finalFileName}.`, "success");
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function exportCsvWithFileSystem(exportRootHandle, plan, result) {
  try {
    throwIfExportStopped();
    const csvBlob = createCsvBlob(plan);
    throwIfExportStopped();
    const finalFileName = await resolveFileName(exportRootHandle, CSV_FILE_NAME);
    await writeBlobToDirectory(exportRootHandle, finalFileName, csvBlob);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${finalFileName} with ${getCsvAuditRowCount(plan)} audit row(s).`, "success");
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Failed CSV export: ${getErrorMessage(error)}`, "error");
  }
}

async function exportHtmlSnapshotWithFileSystem(groupDirectoryHandle, group, file, mode, result) {
  const modeLabel = getHtmlModeLogLabel(mode);
  const usesAssetFolder = isHtmlAssetMode(mode);

  try {
    throwIfExportStopped();
    if (!usesAssetFolder) {
      const finalFileName = await resolveFileName(groupDirectoryHandle, file.fileName);
      logMessage(`Capturing ${modeLabel} for ${group.sanitizedFolderName}/${finalFileName}.`, "progress");
      const htmlPackage = await createCompleteHtmlPackage(group, file, file.referenceAssetFolderName, mode);
      throwIfExportStopped();
      await writeBlobToDirectory(groupDirectoryHandle, finalFileName, htmlPackage.htmlBlob);

      result.success += 1;
      setCounter(elements.successCount, result.success);
      markExportItemsComplete(result);
      logMessage(`Saved ${group.sanitizedFolderName}/${finalFileName}.`, "success");
      return;
    }

    const outputNames = await resolveCompleteOutputNames(groupDirectoryHandle, file);
    logMessage(`Capturing ${modeLabel} for ${group.sanitizedFolderName}/${outputNames.fileName}.`, "progress");
    const htmlPackage = await createCompleteHtmlPackage(group, file, outputNames.assetFolderName, mode);
    throwIfExportStopped();
    const writeFailures = await writeCompleteHtmlPackage(groupDirectoryHandle, outputNames, htmlPackage);
    const warningCount = htmlPackage.failures.length + writeFailures.length;

    result.success += 1;
    result.assetWarnings += warningCount;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${group.sanitizedFolderName}/${outputNames.fileName} and ${group.sanitizedFolderName}/${outputNames.assetFolderName}/.`, "success");
    logAssetWarnings(htmlPackage.failures, writeFailures, `${group.sanitizedFolderName}/${outputNames.assetFolderName}`);
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Failed ${modeLabel} export for ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function getExportRootDirectory(selectedDirectoryHandle) {
  if (!elements.createRootFolder.checked) {
    return selectedDirectoryHandle;
  }

  return selectedDirectoryHandle.getDirectoryHandle(ROOT_FOLDER_NAME, {
    create: true
  });
}

async function resolveFileName(directoryHandle, requestedFileName) {
  throwIfExportStopped();
  if (elements.conflictBehavior.value === "overwrite") {
    await removeEntryIfExists(directoryHandle, requestedFileName);
    return requestedFileName;
  }

  const { baseName, extension } = splitFileName(requestedFileName);
  let candidate = requestedFileName;
  let counter = 1;

  while (await entryExists(directoryHandle, candidate)) {
    throwIfExportStopped();
    candidate = `${baseName} (${counter})${extension}`;
    counter += 1;
  }

  return candidate;
}

async function resolveCompleteOutputNames(directoryHandle, file) {
  throwIfExportStopped();
  if (elements.conflictBehavior.value === "overwrite") {
    await removeEntryIfExists(directoryHandle, file.fileName);
    await removeEntryIfExists(directoryHandle, file.assetFolderName);
    return {
      fileName: file.fileName,
      assetFolderName: file.assetFolderName
    };
  }

  let counter = 0;

  while (true) {
    throwIfExportStopped();
    const baseName = counter === 0
      ? file.baseFileName
      : `${file.baseFileName} (${counter})`;
    const candidateFileName = `${baseName}.html`;
    const candidateAssetFolderName = `${baseName}_files`;
    const fileConflict = await entryExists(directoryHandle, candidateFileName);
    const folderConflict = await entryExists(directoryHandle, candidateAssetFolderName);

    if (!fileConflict && !folderConflict) {
      return {
        fileName: candidateFileName,
        assetFolderName: candidateAssetFolderName
      };
    }

    counter += 1;
  }
}

function splitFileName(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) {
    return {
      baseName: fileName,
      extension: ""
    };
  }

  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex)
  };
}

async function entryExists(directoryHandle, entryName) {
  try {
    await directoryHandle.getFileHandle(entryName, {
      create: false
    });
    return true;
  } catch (error) {
    if (error && error.name === "TypeMismatchError") {
      return true;
    }

    if (!error || error.name !== "NotFoundError") {
      throw error;
    }
  }

  try {
    await directoryHandle.getDirectoryHandle(entryName, {
      create: false
    });
    return true;
  } catch (error) {
    if (error && error.name === "TypeMismatchError") {
      return true;
    }

    if (error && error.name === "NotFoundError") {
      return false;
    }

    throw error;
  }
}

async function removeEntryIfExists(directoryHandle, entryName) {
  try {
    await directoryHandle.removeEntry(entryName, {
      recursive: true
    });
  } catch (error) {
    if (!error || error.name !== "NotFoundError") {
      throw error;
    }
  }
}

async function writeCompleteHtmlPackage(groupDirectoryHandle, outputNames, htmlPackage) {
  const writeFailures = [];
  throwIfExportStopped();
  const assetDirectoryHandle = await groupDirectoryHandle.getDirectoryHandle(outputNames.assetFolderName, {
    create: true
  });

  for (const asset of htmlPackage.assets) {
    throwIfExportStopped();
    try {
      await writeBlobToDirectory(assetDirectoryHandle, asset.fileName, asset.blob);
    } catch (error) {
      if (isExportStopError(error)) {
        throw error;
      }

      writeFailures.push({
        url: asset.url,
        fileName: asset.fileName,
        error: getErrorMessage(error)
      });
    }
  }

  throwIfExportStopped();
  await writeBlobToDirectory(groupDirectoryHandle, outputNames.fileName, htmlPackage.htmlBlob);
  return writeFailures;
}

async function writeBlobToDirectory(directoryHandle, fileName, blob) {
  throwIfExportStopped();
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
    create: true
  });
  throwIfExportStopped();
  const writable = await fileHandle.createWritable({
    keepExistingData: false
  });

  try {
    throwIfExportStopped();
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch (_abortError) {
      // Nothing else can be done once the writer itself fails.
    }

    throw error;
  }
}

async function exportWithDownloadsFallback(plan, result) {
  throwIfExportStopped();
  if (plan.mode === CSV_MODE) {
    throwIfExportStopped();
    await exportCsvWithDownloadsFallback(plan, result);
    return;
  }

  if (isHtmlAssetMode(plan.mode)) {
    logMessage("Downloads fallback uses browser conflict handling for each downloaded file; selected-folder export keeps HTML/assets pairs together more reliably.", "warning");
  }

  for (const group of plan.groups) {
    throwIfExportStopped();
    for (const file of group.files) {
      throwIfExportStopped();
      if (!file.selected) {
        continue;
      }

      if (isHtmlSnapshotMode(plan.mode)) {
        await exportHtmlSnapshotWithDownloadsFallback(group, file, plan.mode, result);
      } else {
        await exportSingleFileWithDownloadsFallback(group, file, plan.mode, result);
      }
    }
  }
}

async function exportSingleFileWithDownloadsFallback(group, file, mode, result) {
  try {
    throwIfExportStopped();
    const blob = await createSingleFileBlob(mode, group, file);
    throwIfExportStopped();
    const filename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`;
    await downloadBlob(blob, filename);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Queued fallback download ${filename}.`, "success");
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Fallback failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function exportCsvWithDownloadsFallback(plan, result) {
  try {
    throwIfExportStopped();
    const csvBlob = createCsvBlob(plan);
    throwIfExportStopped();
    const filename = `${ROOT_FOLDER_NAME}/${CSV_FILE_NAME}`;
    await downloadBlob(csvBlob, filename);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Queued fallback download ${filename} with ${getCsvAuditRowCount(plan)} audit row(s).`, "success");
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Fallback CSV export failed: ${getErrorMessage(error)}`, "error");
  }
}

async function exportHtmlSnapshotWithDownloadsFallback(group, file, mode, result) {
  const modeLabel = getHtmlModeLogLabel(mode);
  const usesAssetFolder = isHtmlAssetMode(mode);

  try {
    throwIfExportStopped();
    logMessage(`Capturing ${modeLabel} for fallback ${group.sanitizedFolderName}/${file.fileName}.`, "progress");
    const referenceAssetFolderName = usesAssetFolder
      ? file.assetFolderName
      : file.referenceAssetFolderName;
    const htmlPackage = await createCompleteHtmlPackage(group, file, referenceAssetFolderName, mode);
    throwIfExportStopped();
    const htmlFilename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`;
    await downloadBlob(htmlPackage.htmlBlob, htmlFilename);

    if (usesAssetFolder) {
      for (const asset of htmlPackage.assets) {
        throwIfExportStopped();
        const assetFilename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.assetFolderName}/${asset.fileName}`;
        try {
          await downloadBlob(asset.blob, assetFilename);
        } catch (error) {
          if (isExportStopError(error)) {
            throw error;
          }

          htmlPackage.failures.push({
            url: asset.url,
            fileName: asset.fileName,
            error: getErrorMessage(error)
          });
        }
      }
    }

    result.success += 1;
    result.assetWarnings += htmlPackage.failures.length;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    if (usesAssetFolder) {
      logMessage(`Queued fallback downloads for ${htmlFilename} and ${file.assetFolderName}/.`, "success");
      logAssetWarnings(htmlPackage.failures, [], `${group.sanitizedFolderName}/${file.assetFolderName}`);
    } else {
      logMessage(`Queued fallback download ${htmlFilename}.`, "success");
    }
  } catch (error) {
    if (isExportStopError(error)) {
      throw error;
    }

    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Fallback ${modeLabel} failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function downloadBlob(blob, filename) {
  throwIfExportStopped();
  const objectUrl = URL.createObjectURL(blob);

  try {
    await downloadBlobUrl(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

function downloadBlobUrl(url, filename) {
  throwIfExportStopped();
  const conflictAction = elements.conflictBehavior.value === "overwrite" ? "overwrite" : "uniquify";

  return download({
    url,
    filename,
    conflictAction,
    saveAs: false
  }).then((downloadId) => {
    if (typeof downloadId !== "number") {
      throw new Error("The browser did not return a download ID.");
    }

    return downloadId;
  });
}

async function createSingleFileBlob(mode, group, file) {
  if (mode === MHTML_MODE) {
    return saveTabAsMhtml(file.tabId);
  }

  throw new Error(`Unsupported single-file export mode: ${mode}`);
}

function createCsvBlob(plan) {
  return new Blob([generateCsvIndex(plan)], {
    type: "text/csv;charset=utf-8"
  });
}

function generateCsvIndex(plan) {
  return ExportHelpers.generateCsvIndex(plan);
}

function getCsvAuditRowCount(plan) {
  return (plan.totalEligibleTabs || 0) + (plan.skippedTabs ? plan.skippedTabs.length : 0);
}

function formatCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function cleanCsvPageTitle(value) {
  return normalizeBooleanTitleText(repairMojibake(String(value || "")))
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repairMojibake(value) {
  return String(value)
    .replace(/\u00e2\u20ac\u0153/g, "\u201C")
    .replace(/\u00e2\u20ac\u009d/g, "\u201D")
    .replace(/\u00e2\u20ac\u2122/g, "\u2019")
    .replace(/\u00e2\u20ac\u02dc/g, "\u2018")
    .replace(/\u00e2\u20ac\u201c/g, "\u2013")
    .replace(/\u00e2\u20ac\u201d/g, "\u2014")
    .replace(/\u00e2\u20ac\u00a6/g, "\u2026")
    .replace(/\u00c2\u00a0/g, " ");
}

function normalizeBooleanTitleText(value) {
  return String(value)
    .replace(/\s*(\bAND\b|\bOR\b)\s*/g, " $1 ")
    .replace(/\s+([),])/g, "$1")
    .replace(/([(])\s+/g, "$1");
}

async function createCompleteHtmlPackage(group, file, assetFolderName, mode) {
  throwIfExportStopped();
  const serializerAssetMode = getHtmlSerializerAssetMode(mode);
  const fetchAssetMode = getHtmlFetchAssetMode(mode);
  const capturedPage = await captureCompleteHtmlSnapshot(file.tabId, assetFolderName, serializerAssetMode);
  throwIfExportStopped();
  const context = createAssetContext(assetFolderName, fetchAssetMode);

  if (shouldDownloadHtmlAssets(mode)) {
    for (const resource of capturedPage.resources) {
      throwIfExportStopped();
      await ensureAsset(resource.url, resource.fileName, resource.kind, context);
    }
  }

  throwIfExportStopped();
  const htmlWithMetadata = addExportMetadataComment(capturedPage.html, group, file, context.failures.length, mode);

  return {
    htmlBlob: new Blob([htmlWithMetadata], {
      type: "text/html;charset=utf-8"
    }),
    assets: context.assets,
    failures: context.failures
  };
}

function captureCompleteHtmlSnapshot(tabId, assetFolderName, assetMode) {
  const options = {
    assetFolderName,
    assetMode
  };

  return executeSerializerInTab(tabId, options).then((capturedPage) => {
    if (!capturedPage || typeof capturedPage.html !== "string" || !Array.isArray(capturedPage.resources)) {
      throw new Error("The page serializer did not return an HTML snapshot.");
    }

    return capturedPage;
  });
}

function executeSerializerInTab(tabId, options) {
  const scriptingApi = getScriptingApi();
  if (scriptingApi && typeof scriptingApi.executeScript === "function") {
    return executeSerializerWithScriptingApi(scriptingApi, tabId, options);
  }

  if (chrome.tabs && typeof chrome.tabs.executeScript === "function") {
    return executeSerializerWithLegacyTabsApi(tabId, options);
  }

  if (chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
    return executeSerializerWithBackground(tabId, options);
  }

  return Promise.reject(new Error(
    "HTML export requires the scripting API or the background serializer. Reload TabPack from your browser extensions page after updating the extension, then reopen TabPack."
  ));
}

function getScriptingApi() {
  if (typeof chrome !== "undefined" && chrome.scripting) {
    return {
      api: chrome.scripting,
      style: "callback"
    };
  }

  if (typeof browser !== "undefined" && browser.scripting) {
    return {
      api: browser.scripting,
      style: "promise"
    };
  }

  return null;
}

function executeSerializerWithScriptingApi(scriptingApiInfo, tabId, options) {
  const executeOptions = {
    target: {
      tabId
    },
    func: serializeCompleteHtmlInPage,
    args: [
      options
    ]
  };

  if (scriptingApiInfo.style === "promise") {
    return scriptingApiInfo.api.executeScript(executeOptions).then((results) => {
      const firstResult = Array.isArray(results) ? results[0] : null;
      return firstResult ? firstResult.result : null;
    });
  }

  return executeScript(executeOptions).then((results) => {
    const firstResult = Array.isArray(results) ? results[0] : null;
    return firstResult ? firstResult.result : null;
  });
}

function executeSerializerWithLegacyTabsApi(tabId, options) {
  const code = `(${serializeCompleteHtmlInPage.toString()})(${JSON.stringify(options)})`;
  return executeLegacyTabScript(tabId, {
    code,
    runAt: "document_idle"
  }).then((results) => {
    return Array.isArray(results) ? results[0] : null;
  });
}

function executeSerializerWithBackground(tabId, options) {
  return sendRuntimeMessage({
    type: RUN_SERIALIZER_IN_TAB_MESSAGE,
    tabId,
    options
  }).catch((error) => {
    throw new Error(formatBackgroundSerializerError(error.message));
  }).then((response) => {
    if (!response) {
      throw new Error("The background serializer returned no response.");
    }

    if (!response.ok) {
      throw new Error(response.error || "The background serializer failed.");
    }

    return response.result || null;
  });
}

function formatBackgroundSerializerError(message) {
  const details = String(message || "").trim();
  if (/receiving end does not exist/i.test(details)) {
    return "The background serializer is not available. Reload TabPack from your browser extensions page, then reopen TabPack.";
  }

  return details
    ? `The background serializer failed: ${details}`
    : "The background serializer failed.";
}

function createAssetContext(assetFolderName, assetMode) {
  return {
    assetFolderName,
    assetMode: assetMode || HTML_ASSET_ALL,
    usedFileNames: new Set(),
    assetPromisesByUrl: new Map(),
    assets: [],
    failures: []
  };
}

async function ensureAsset(rawUrl, preferredFileName, kind, context) {
  throwIfExportStopped();
  const absoluteUrl = normalizeFetchableAssetUrl(rawUrl);
  if (!absoluteUrl) {
    return null;
  }

  if (context.assetPromisesByUrl.has(absoluteUrl)) {
    return context.assetPromisesByUrl.get(absoluteUrl);
  }

  const fileName = preferredFileName
    ? reservePreferredAssetFileName(preferredFileName, context)
    : allocateAssetFileName(absoluteUrl, kind, context);

  const assetPromise = (async () => {
    try {
      const blob = await fetchAssetAsBlob(absoluteUrl, kind, context);
      context.assets.push({
        url: absoluteUrl,
        fileName,
        blob
      });
      return fileName;
    } catch (error) {
      if (isExportStopError(error)) {
        throw error;
      }

      context.failures.push({
        url: absoluteUrl,
        fileName,
        error: getErrorMessage(error)
      });
      return null;
    }
  })();

  context.assetPromisesByUrl.set(absoluteUrl, assetPromise);
  return assetPromise;
}

function normalizeFetchableAssetUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    return parsedUrl.href;
  } catch (_error) {
    return null;
  }
}

function reservePreferredAssetFileName(fileName, context) {
  const sanitized = trimAssetFileName(sanitizeAssetFileName(fileName)) || "asset";

  if (!context.usedFileNames.has(sanitized.toLowerCase())) {
    context.usedFileNames.add(sanitized.toLowerCase());
    return sanitized;
  }

  return uniquifyAssetFileName(sanitized, context);
}

function allocateAssetFileName(absoluteUrl, kind, context) {
  const fallbackExtension = getFallbackExtension(kind);
  let candidate = "";

  try {
    const parsedUrl = new URL(absoluteUrl);
    const pathname = parsedUrl.pathname;
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
    candidate = decodeURIComponent(lastSegment || "");
  } catch (_error) {
    candidate = "";
  }

  candidate = sanitizeAssetFileName(candidate);

  if (!candidate) {
    candidate = `asset${fallbackExtension}`;
  } else if (!candidate.includes(".") && fallbackExtension) {
    candidate = `${candidate}${fallbackExtension}`;
  }

  return uniquifyAssetFileName(candidate, context);
}

function sanitizeAssetFileName(fileName) {
  const sanitized = String(fileName)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/^\.+/g, "")
    .replace(/[.\s]+$/g, "")
    .trim();
  return isReservedWindowsName(sanitized) ? `${sanitized}_asset` : sanitized;
}

function trimAssetFileName(fileName) {
  if (fileName.length <= MAX_ASSET_FILE_NAME_LENGTH) {
    return fileName;
  }

  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex > fileName.length - 16) {
    const extension = fileName.slice(dotIndex);
    return fileName
      .slice(0, MAX_ASSET_FILE_NAME_LENGTH - extension.length)
      .replace(/[.\s]+$/g, "") + extension;
  }

  return fileName.slice(0, MAX_ASSET_FILE_NAME_LENGTH).replace(/[.\s]+$/g, "");
}

function uniquifyAssetFileName(fileName, context) {
  const splitName = splitFileName(trimAssetFileName(fileName || "asset") || "asset");
  let candidate = `${splitName.baseName}${splitName.extension}`;
  let counter = 1;

  while (context.usedFileNames.has(candidate.toLowerCase())) {
    candidate = `${splitName.baseName} (${counter})${splitName.extension}`;
    candidate = trimAssetFileName(candidate);
    counter += 1;
  }

  context.usedFileNames.add(candidate.toLowerCase());
  return candidate;
}

function getFallbackExtension(kind) {
  if (kind === "style") {
    return ".css";
  }

  if (kind === "script") {
    return ".js";
  }

  if (kind === "manifest") {
    return ".webmanifest";
  }

  return "";
}

async function fetchAssetAsBlob(absoluteUrl, kind, context) {
  throwIfExportStopped();
  const response = await fetch(absoluteUrl, {
    credentials: "include",
    cache: "force-cache",
    signal: state.exportAbortController ? state.exportAbortController.signal : undefined
  });
  throwIfExportStopped();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
  }

  const contentType = response.headers.get("content-type") || "";

  if (kind === "style" || looksLikeCssAsset(absoluteUrl, contentType)) {
    const cssText = await response.text();
    throwIfExportStopped();
    const rewrittenCss = context.assetMode === HTML_ASSET_ALL
      ? await rewriteCssAssetUrls(cssText, absoluteUrl, context)
      : absolutizeCssAssetUrls(cssText, absoluteUrl);
    return new Blob([rewrittenCss], {
      type: contentType || "text/css;charset=utf-8"
    });
  }

  const blob = await response.blob();
  throwIfExportStopped();
  return blob;
}

function looksLikeCssAsset(absoluteUrl, contentType) {
  if (/text\/css/i.test(contentType)) {
    return true;
  }

  try {
    return new URL(absoluteUrl).pathname.toLowerCase().endsWith(".css");
  } catch (_error) {
    return false;
  }
}

async function rewriteCssAssetUrls(cssText, cssUrl, context) {
  const withUrls = await rewriteCssUrlFunctions(cssText, cssUrl, context);
  return rewriteCssImports(withUrls, cssUrl, context);
}

function absolutizeCssAssetUrls(cssText, cssUrl) {
  const withUrls = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, rawUrl) => {
    const absoluteUrl = resolveNestedAssetUrl(rawUrl, cssUrl);
    return absoluteUrl ? `url("${escapeCssString(absoluteUrl)}")` : match;
  });

  return withUrls.replace(/@import\s+(['"])([^'"]+)\1/g, (match, _quote, rawUrl) => {
    const absoluteUrl = resolveNestedAssetUrl(rawUrl, cssUrl);
    return absoluteUrl ? `@import "${escapeCssString(absoluteUrl)}"` : match;
  });
}

async function rewriteCssUrlFunctions(cssText, cssUrl, context) {
  const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let result = "";
  let lastIndex = 0;
  let match = urlRegex.exec(cssText);

  while (match) {
    throwIfExportStopped();
    const rawUrl = match[2].trim();
    const replacement = await makeCssLocalUrl(match[0], rawUrl, cssUrl, "asset", context);
    result += cssText.slice(lastIndex, match.index);
    result += replacement;
    lastIndex = match.index + match[0].length;
    match = urlRegex.exec(cssText);
  }

  return result + cssText.slice(lastIndex);
}

async function rewriteCssImports(cssText, cssUrl, context) {
  const importRegex = /@import\s+(['"])([^'"]+)\1/g;
  let result = "";
  let lastIndex = 0;
  let match = importRegex.exec(cssText);

  while (match) {
    throwIfExportStopped();
    const rawUrl = match[2].trim();
    const replacement = await makeCssImportLocalUrl(match[0], rawUrl, cssUrl, context);
    result += cssText.slice(lastIndex, match.index);
    result += replacement;
    lastIndex = match.index + match[0].length;
    match = importRegex.exec(cssText);
  }

  return result + cssText.slice(lastIndex);
}

async function makeCssLocalUrl(originalText, rawUrl, cssUrl, kind, context) {
  throwIfExportStopped();
  const absoluteUrl = resolveNestedAssetUrl(rawUrl, cssUrl);
  if (!absoluteUrl) {
    return originalText;
  }

  const localFileName = await ensureAsset(absoluteUrl, null, kind, context);
  return localFileName ? `url("${escapeCssString(localFileName)}")` : originalText;
}

async function makeCssImportLocalUrl(originalText, rawUrl, cssUrl, context) {
  throwIfExportStopped();
  const absoluteUrl = resolveNestedAssetUrl(rawUrl, cssUrl);
  if (!absoluteUrl) {
    return originalText;
  }

  const localFileName = await ensureAsset(absoluteUrl, null, "style", context);
  return localFileName ? `@import "${escapeCssString(localFileName)}"` : originalText;
}

function resolveNestedAssetUrl(rawUrl, baseUrl) {
  if (!rawUrl) {
    return null;
  }

  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed ||
    trimmed.startsWith("#") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("about:")) {
    return null;
  }

  try {
    const absoluteUrl = new URL(trimmed, baseUrl);
    if (absoluteUrl.protocol !== "http:" && absoluteUrl.protocol !== "https:") {
      return null;
    }

    return absoluteUrl.href;
  } catch (_error) {
    return null;
  }
}

function escapeCssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function addExportMetadataComment(html, group, file, assetFailureCount, mode) {
  const metadata = [
    `TabPack ${getHtmlModeLogLabel(mode)} export`,
    `Original title: ${file.title}`,
    `Original URL: ${file.url}`,
    `Tab group: ${group.originalTitle}`,
    `Order: ${file.order}`,
    `Exported: ${new Date().toISOString()}`,
    `Asset failures: ${assetFailureCount}`
  ].map((line) => line.replace(/--/g, "- -")).join("\n");

  return html.replace(/(<html\b[^>]*>)/i, `$1\n<!--\n${metadata}\n-->`);
}

function logAssetWarnings(fetchFailures, writeFailures, assetFolderLabel) {
  const allFailures = [
    ...fetchFailures.map((failure) => ({
      ...failure,
      stage: "fetch"
    })),
    ...writeFailures.map((failure) => ({
      ...failure,
      stage: "write"
    }))
  ];

  if (!allFailures.length) {
    return;
  }

  logMessage(`${assetFolderLabel}: ${allFailures.length} asset(s) could not be saved. The HTML was still written, but some local references may be missing.`, "warning");

  for (const failure of allFailures.slice(0, 5)) {
    logMessage(`Asset ${failure.stage} warning for ${failure.fileName}: ${failure.error}`, "warning");
  }

  if (allFailures.length > 5) {
    logMessage(`${assetFolderLabel}: ${allFailures.length - 5} additional asset warning(s) hidden from the log.`, "warning");
  }
}

function saveTabAsMhtml(tabId) {
  return saveAsMHTML({ tabId }).then((blob) => {
    if (!(blob instanceof Blob)) {
      throw new Error("MHTML capture did not return a Blob.");
    }

    return blob;
  });
}

function refreshPlanDisplay() {
  if (!state.exportPlan) {
    updateExportAvailability();
    return;
  }

  applyModeAndPaths(state.exportPlan);
  renderPreview();
  updateExportAvailability();
}

function applyModeAndPaths(plan) {
  ExportHelpers.applyModeAndPaths(plan, getPathOptions());
  updateScanCounters(plan);
}

function getPathOptions() {
  return {
    mode: getSelectedMode(),
    rootFolderName: ROOT_FOLDER_NAME,
    createRootFolder: elements.createRootFolder.checked,
    downloadsFallback: isDownloadsFallbackSelected(),
    noGroupId: NO_GROUP_ID
  };
}

function buildPlannedRelativePath(groupFolderName, fileName) {
  return ExportHelpers.buildPlannedRelativePath(groupFolderName, fileName, getPathOptions());
}

function buildRootRelativePath(fileName) {
  return ExportHelpers.buildRootRelativePath(fileName, getPathOptions());
}

function getSelectedMode() {
  const selectedInput = elements.modeInputs.find((input) => input.checked);
  return selectedInput ? selectedInput.value : HTML_RELEVANT_ASSETS_MODE;
}

function isHtmlSnapshotMode(mode) {
  return mode === HTML_PAGE_MODE ||
    mode === HTML_LOCAL_ASSET_PATHS_MODE ||
    mode === HTML_RELEVANT_ASSETS_MODE ||
    mode === HTML_ALL_ASSETS_MODE;
}

function isHtmlLocalReferenceMode(mode) {
  return mode === HTML_LOCAL_ASSET_PATHS_MODE;
}

function isHtmlAssetMode(mode) {
  return mode === HTML_RELEVANT_ASSETS_MODE || mode === HTML_ALL_ASSETS_MODE;
}

function getHtmlSerializerAssetMode(mode) {
  if (mode === HTML_PAGE_MODE) {
    return HTML_ASSET_NONE;
  }

  if (mode === HTML_LOCAL_ASSET_PATHS_MODE ||
    mode === HTML_RELEVANT_ASSETS_MODE ||
    mode === HTML_ALL_ASSETS_MODE) {
    return HTML_ASSET_RELEVANT;
  }

  return HTML_ASSET_NONE;
}

function getHtmlFetchAssetMode(mode) {
  if (mode === HTML_ALL_ASSETS_MODE) {
    return HTML_ASSET_ALL;
  }

  if (mode === HTML_RELEVANT_ASSETS_MODE) {
    return HTML_ASSET_RELEVANT;
  }

  return HTML_ASSET_NONE;
}

function shouldDownloadHtmlAssets(mode) {
  return isHtmlAssetMode(mode);
}

function getHtmlModeLogLabel(mode) {
  if (mode === HTML_PAGE_MODE) {
    return "HTML page with online assets";
  }

  if (mode === HTML_LOCAL_ASSET_PATHS_MODE) {
    return "HTML page with local asset paths";
  }

  if (mode === HTML_RELEVANT_ASSETS_MODE) {
    return "HTML page with relevant assets";
  }

  return "HTML page with all assets";
}

function isDownloadsFallbackSelected() {
  return !elements.fallbackPanel.classList.contains("hidden") && elements.useDownloadsFallback.checked;
}

function renderPreview() {
  elements.preview.textContent = "";

  if (!state.exportPlan || state.exportPlan.totalEligibleTabs === 0) {
    clearPreview("No eligible grouped HTTP/HTTPS tabs to export.");
    return;
  }

  const fragment = document.createDocumentFragment();
  const destination = document.createElement("p");
  destination.className = "muted";
  destination.textContent = isDownloadsFallbackSelected()
    ? `Base destination: Downloads/${ROOT_FOLDER_NAME}/ fallback`
    : elements.createRootFolder.checked
      ? `Base destination: selected folder/${ROOT_FOLDER_NAME}/`
      : "Base destination: selected folder/";
  fragment.append(destination);

  if (state.exportPlan.mode === CSV_MODE) {
    const csvBlock = document.createElement("div");
    csvBlock.className = "group-preview";

    const heading = document.createElement("h3");
    heading.textContent = "CSV page index";
    csvBlock.append(heading);

    const csvFields = document.createElement("div");
    csvFields.className = "preview-fields";
    appendPreviewField(csvFields, "CSV file", state.exportPlan.csvRelativePath, {
      path: true
    });
    appendPreviewField(csvFields, "Rows", `${getCsvAuditRowCount(state.exportPlan)} audit rows: selected, deselected, and skipped tabs`);
    csvBlock.append(csvFields);

    fragment.append(csvBlock);
  }

  for (const group of state.exportPlan.groups) {
    const groupBlock = document.createElement("div");
    groupBlock.className = "group-preview";

    const groupSelection = getGroupSelectionState(group);
    const groupLabel = document.createElement("label");
    groupLabel.className = "group-select";

    const groupCheckbox = document.createElement("input");
    groupCheckbox.type = "checkbox";
    groupCheckbox.checked = groupSelection.checked;
    groupCheckbox.indeterminate = groupSelection.indeterminate;
    groupCheckbox.dataset.groupId = String(group.groupId);
    groupCheckbox.addEventListener("change", () => {
      setGroupSelection(group.groupId, groupCheckbox.checked);
    });

    const groupTitle = document.createElement("span");
    groupTitle.className = "group-title";

    const heading = document.createElement("h3");
    heading.textContent = group.originalTitle;
    groupTitle.append(heading);

    const selectionSummary = document.createElement("span");
    selectionSummary.className = "selection-summary";
    selectionSummary.textContent = `${group.selectedCount} of ${group.files.length} selected`;
    groupTitle.append(selectionSummary);

    if (group.originalTitle !== group.sanitizedFolderName) {
      const outputFolder = document.createElement("span");
      outputFolder.className = "selection-summary";
      outputFolder.textContent = `Output folder: ${group.sanitizedFolderName}`;
      groupTitle.append(outputFolder);
    }

    groupLabel.append(groupCheckbox, groupTitle);
    groupBlock.append(groupLabel);

    const list = document.createElement("ul");
    for (const file of group.files) {
      const item = document.createElement("li");
      if (!file.selected) {
        item.className = "deselected";
      }

      const tabLabel = document.createElement("label");
      tabLabel.className = "tab-select";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = file.selected;
      checkbox.dataset.selectionKey = file.selectionKey;
      checkbox.addEventListener("change", () => {
        setFileSelection(file.selectionKey, checkbox.checked);
      });

      const body = document.createElement("span");
      body.className = "tab-preview-body";

      const fields = document.createElement("span");
      fields.className = "preview-fields";
      appendPreviewField(fields, "Title", file.title);

      if (state.exportPlan.mode === CSV_MODE) {
        appendPreviewField(fields, "CSV status", file.selected ? "selected_for_export=true" : "selected_for_export=false");
        if (file.selected) {
          appendPreviewField(fields, "Selected order", String(file.selectedOrderInGroup));
        } else {
          appendPreviewField(fields, "Status", "Not selected", {
            note: true
          });
        }
      } else {
        if (file.selected) {
          appendPreviewField(fields, "File", file.plannedRelativePath, {
            path: true
          });
        } else {
          appendPreviewField(fields, "Status", "Not selected", {
            note: true
          });
        }

        if (file.plannedAssetFolderPath) {
          appendPreviewField(fields, "Assets", `${file.plannedAssetFolderPath} (${getAssetFolderPreviewLabel(state.exportPlan.mode)})`, {
            path: true
          });
        }

        if (file.plannedReferenceAssetFolderPath) {
          appendPreviewField(fields, "Assets", file.plannedReferenceAssetFolderPath, {
            path: true
          });
          appendPreviewField(fields, "Note", "Folder is referenced only; assets are not downloaded", {
            note: true
          });
        }
      }

      body.append(fields);
      tabLabel.append(checkbox, body);
      item.append(tabLabel);

      list.append(item);
    }

    groupBlock.append(list);
    fragment.append(groupBlock);
  }

  elements.preview.append(fragment);
}

function appendPreviewField(container, label, value, options = {}) {
  const field = document.createElement("span");
  field.className = "preview-field";

  const labelElement = document.createElement("span");
  labelElement.className = "preview-label";
  labelElement.textContent = `${label}:`;

  const valueElement = document.createElement("span");
  valueElement.className = options.note ? "preview-value preview-note" : "preview-value";
  if (options.path) {
    valueElement.classList.add("path");
  }
  valueElement.textContent = value;

  field.append(labelElement, valueElement);
  container.append(field);
}

function getGroupSelectionState(group) {
  const selectedCount = group.files.filter((file) => file.selected).length;
  return {
    checked: selectedCount > 0 && selectedCount === group.files.length,
    indeterminate: selectedCount > 0 && selectedCount < group.files.length
  };
}

function setGroupSelection(groupId, selected) {
  if (!state.exportPlan) {
    return;
  }

  for (const group of state.exportPlan.groups) {
    if (group.groupId !== groupId) {
      continue;
    }

    for (const file of group.files) {
      file.selected = selected;
    }
    break;
  }

  refreshPlanDisplay();
}

function setFileSelection(selectionKey, selected) {
  if (!state.exportPlan) {
    return;
  }

  for (const group of state.exportPlan.groups) {
    const file = group.files.find((candidate) => candidate.selectionKey === selectionKey);
    if (file) {
      file.selected = selected;
      break;
    }
  }

  refreshPlanDisplay();
}

function getAssetFolderPreviewLabel(mode) {
  if (mode === HTML_RELEVANT_ASSETS_MODE) {
    return "relevant assets folder";
  }

  if (mode === HTML_ALL_ASSETS_MODE) {
    return "all assets folder";
  }

  return "assets folder";
}

function renderSkippedTabs() {
  elements.skippedTabs.textContent = "";
  elements.skippedSummaryText.textContent = `(${state.skippedTabs.length})`;

  if (!state.skippedTabs.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No skipped tabs.";
    elements.skippedTabs.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "skipped-list";

  for (const skippedTab of state.skippedTabs) {
    const item = document.createElement("li");
    item.textContent = `${skippedTab.reason}: ${skippedTab.title} (${skippedTab.url})`;
    list.append(item);
  }

  elements.skippedTabs.append(list);
}

function clearPreview(message) {
  elements.preview.textContent = "";
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = message;
  elements.preview.append(paragraph);
}

function clearSkippedTabs() {
  elements.skippedTabs.textContent = "";
  elements.skippedSummaryText.textContent = "(0)";
  const paragraph = document.createElement("p");
  paragraph.className = "muted";
  paragraph.textContent = "No skipped tabs yet.";
  elements.skippedTabs.append(paragraph);
}

function updateExportAvailability() {
  const hasPlan = Boolean(state.exportPlan && state.exportPlan.totalEligibleTabs > 0);
  const hasSelection = Boolean(state.exportPlan && (
    state.exportPlan.mode === CSV_MODE ||
    state.exportPlan.totalSelectedTabs > 0
  ));
  const hasSelectedFolder = Boolean(state.selectedDirectoryHandle && state.selectedDirectoryWritable);
  const hasDestination = hasSelectedFolder || isDownloadsFallbackSelected();
  elements.exportButton.disabled = state.isExporting || !hasPlan || !hasSelection || !hasDestination;
  elements.stopExportButton.disabled = !state.isExporting || state.stopRequested;
}

function updateScanCounters(plan) {
  setCounter(elements.eligibleCount, plan.totalEligibleTabs);
  setCounter(elements.selectedCount, plan.totalSelectedTabs || 0);
  setCounter(elements.skippedCount, plan.skippedTabs.length);
  elements.skippedSummaryText.textContent = `(${plan.skippedTabs.length})`;
}

function resetCounters() {
  setCounter(elements.eligibleCount, 0);
  setCounter(elements.selectedCount, 0);
  setCounter(elements.skippedCount, 0);
  setCounter(elements.successCount, 0);
  setCounter(elements.failureCount, 0);
  elements.skippedSummaryText.textContent = "(0)";
}

function setCounter(element, value) {
  element.textContent = String(value);
}

function setExportProgressIdle(message) {
  if (!elements.exportProgressPanel) {
    return;
  }

  elements.exportProgressPanel.className = "export-progress";
  elements.exportProgressPercent.textContent = "0%";
  elements.exportProgressBar.style.inlineSize = "0%";
  if (elements.exportProgressTrack) {
    elements.exportProgressTrack.setAttribute("aria-valuenow", "0");
  }
  elements.exportProgressDetail.textContent = message;
}

function resetExportProgress(totalItems, unit) {
  if (!elements.exportProgressPanel) {
    return;
  }

  const result = {
    success: 0,
    failure: 0,
    completedItems: 0,
    totalItems,
    progressUnit: unit
  };
  elements.exportProgressPanel.className = "export-progress";
  updateExportProgress(result, "Export is starting.");
}

function markExportItemsComplete(result, count = 1) {
  if (!result || !Number.isFinite(result.totalItems)) {
    return;
  }

  result.completedItems = Math.min(result.totalItems, result.completedItems + count);
  updateExportProgress(result, "Export is running.");
}

function finishExportProgress(result, state) {
  if (!result || !elements.exportProgressPanel) {
    return;
  }

  const statusText = state === "done"
    ? "Export finished."
    : state === "warning"
      ? "Export finished with failures or warnings."
      : state === "stopped"
        ? "Export stopped by user."
        : "Export stopped before all items were concluded.";
  updateExportProgress(result, statusText);
  elements.exportProgressPanel.classList.toggle("done", state === "done");
  elements.exportProgressPanel.classList.toggle("warning", state === "warning");
  elements.exportProgressPanel.classList.toggle("error", state === "error");
  elements.exportProgressPanel.classList.toggle("stopped", state === "stopped");
}

function updateExportProgress(result, statusText) {
  if (!elements.exportProgressPanel) {
    return;
  }

  const total = Math.max(0, result.totalItems || 0);
  const completed = Math.min(total, Math.max(0, result.completedItems || 0));
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const unitLabel = total === 1 ? result.progressUnit : `${result.progressUnit}s`;
  const success = result.success || 0;
  const failure = result.failure || 0;

  elements.exportProgressPercent.textContent = `${percent}%`;
  elements.exportProgressBar.style.inlineSize = `${percent}%`;
  if (elements.exportProgressTrack) {
    elements.exportProgressTrack.setAttribute("aria-valuenow", String(percent));
  }
  elements.exportProgressDetail.textContent =
    `${completed} of ${total} ${unitLabel} concluded (${success} succeeded, ${failure} failed). ${statusText}`;
}

function logMessage(message, level = "info") {
  const item = document.createElement("div");
  item.className = `log-entry ${level}`;

  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date().toLocaleTimeString();

  const badge = document.createElement("span");
  badge.className = "log-badge";
  badge.textContent = getLogLevelLabel(level);

  const text = document.createElement("span");
  text.className = "log-message";
  text.textContent = message;

  item.append(time, badge, text);
  elements.progressLog.append(item);
  elements.progressLog.parentElement.scrollTop = elements.progressLog.parentElement.scrollHeight;
}

function getLogLevelLabel(level) {
  if (level === "start") {
    return "START";
  }

  if (level === "progress") {
    return "WORKING";
  }

  if (level === "success") {
    return "DONE";
  }

  if (level === "warning") {
    return "WARNING";
  }

  if (level === "error") {
    return "ERROR";
  }

  return "INFO";
}

function getErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }

  return error.message || String(error);
}

function isUserCancellation(error) {
  return error && (error.name === "AbortError" || /aborted|cancel/i.test(getErrorMessage(error)));
}
