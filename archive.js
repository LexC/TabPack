"use strict";

const ROOT_FOLDER_NAME = "TabGroupVault";
const MAX_FOLDER_NAME_LENGTH = 80;
const MAX_ASSET_FILE_NAME_LENGTH = 120;
const HTML_PAGE_MODE = "html";
const HTML_LOCAL_ASSET_PATHS_MODE = "html-local";
const HTML_RELEVANT_ASSETS_MODE = "html-relevant";
const HTML_ALL_ASSETS_MODE = "html-all";
const CSV_MODE = "csv";
const MHTML_MODE = "mhtml";
const HTML_ASSET_NONE = "none";
const HTML_ASSET_RELEVANT = "relevant";
const HTML_ASSET_ALL = "all";
const CSV_FILE_NAME = "tab-groups.csv";
const RUN_SERIALIZER_IN_TAB_MESSAGE = "TabGroupVault.runSerializerInTab";
const NO_GROUP_ID = chrome.tabGroups && typeof chrome.tabGroups.TAB_GROUP_ID_NONE === "number"
  ? chrome.tabGroups.TAB_GROUP_ID_NONE
  : -1;

const state = {
  selectedDirectoryHandle: null,
  selectedDirectoryWritable: false,
  exportPlan: null,
  skippedTabs: [],
  isExporting: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  initializeDestinationUi();
  resetCounters();
  setExportProgressIdle("Export progress will appear here when an export starts.");
  updateExportAvailability();
});

function bindElements() {
  elements.scanButton = document.getElementById("scanButton");
  elements.exportButton = document.getElementById("exportButton");
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
  elements.modeInputs = Array.from(document.querySelectorAll("input[name='exportMode']"));
}

function bindEvents() {
  elements.scanButton.addEventListener("click", scanGroupedTabs);
  elements.exportButton.addEventListener("click", exportGroupedTabs);
  elements.chooseFolderButton.addEventListener("click", chooseOutputFolder);
  elements.createRootFolder.addEventListener("change", refreshPlanDisplay);
  elements.useDownloadsFallback.addEventListener("change", () => {
    updateExportAvailability();
    refreshPlanDisplay();
  });

  for (const input of elements.modeInputs) {
    input.addEventListener("change", refreshPlanDisplay);
  }

  for (const button of elements.conflictButtons) {
    button.addEventListener("click", () => {
      setConflictBehavior(button.dataset.conflictValue);
    });
  }
}

function setConflictBehavior(value) {
  elements.conflictBehavior.value = value;

  for (const button of elements.conflictButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.conflictValue === value));
  }
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
    elements.selectedFolderText.textContent = "Selected folder name: ";

    const folderName = document.createElement("span");
    folderName.className = "folder-name";
    folderName.textContent = directoryHandle.name || "chosen folder";
    elements.selectedFolderText.append(folderName);
    elements.selectedFolderText.append(" (full path is not exposed by Edge to extension pages)");
    elements.selectedFolderText.className = "status good";

    logMessage(`Selected output folder name: ${directoryHandle.name || "chosen folder"}. Full path is not exposed by Edge.`, "success");
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
  logMessage("Starting scan of the current Edge window for grouped HTTP/HTTPS tabs.", "start");

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
      logMessage(`Scan finished. ${plan.totalEligibleTabs} eligible grouped tab(s), ${plan.skippedTabs.length} skipped.`, "success");
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
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}

async function buildExportPlan(tabs) {
  const skippedTabs = [];
  const eligibleTabs = [];
  const sortedTabs = [...tabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  for (const tab of sortedTabs) {
    if (typeof tab.id !== "number") {
      skippedTabs.push(makeSkippedTab(tab, "missing tab ID"));
      continue;
    }

    if (tab.groupId === NO_GROUP_ID || typeof tab.groupId !== "number") {
      skippedTabs.push(makeSkippedTab(tab, "ungrouped"));
      continue;
    }

    if (!isSupportedTabUrl(tab.url)) {
      skippedTabs.push(makeSkippedTab(tab, "unsupported URL"));
      continue;
    }

    eligibleTabs.push(tab);
  }

  const groupIds = [...new Set(eligibleTabs.map((tab) => tab.groupId))];
  const groupMetadata = await loadTabGroupMetadata(groupIds);
  const groupsById = new Map();

  for (const tab of eligibleTabs) {
    const metadata = groupMetadata.get(tab.groupId);
    if (!metadata) {
      skippedTabs.push(makeSkippedTab(tab, "missing group metadata"));
      continue;
    }

    if (!groupsById.has(tab.groupId)) {
      const originalTitle = metadata.title || `Group_${tab.groupId}`;
      groupsById.set(tab.groupId, {
        groupId: tab.groupId,
        originalTitle,
        sanitizedFolderName: "",
        firstTabIndex: tab.index ?? 0,
        files: []
      });
    }

    groupsById.get(tab.groupId).files.push({
      tabId: tab.id,
      tabIndex: tab.index ?? 0,
      order: 0,
      title: tab.title || tab.url || "Untitled page",
      url: tab.url,
      outputExtension: "",
      baseFileName: "",
      fileName: "",
      referenceAssetFolderName: "",
      assetFolderName: "",
      plannedRelativePath: "",
      plannedReferenceAssetFolderPath: "",
      plannedAssetFolderPath: ""
    });
  }

  const groups = [...groupsById.values()].sort((a, b) => a.firstTabIndex - b.firstTabIndex);
  assignUniqueFolderNames(groups);

  for (const group of groups) {
    group.files.sort((a, b) => a.tabIndex - b.tabIndex);
    group.files.forEach((file, index) => {
      file.order = index + 1;
    });
  }

  const plan = {
    mode: getSelectedMode(),
    generatedAt: new Date().toISOString(),
    groups,
    skippedTabs,
    totalEligibleTabs: groups.reduce((total, group) => total + group.files.length, 0)
  };

  applyModeAndPaths(plan);
  return plan;
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
  return new Promise((resolve, reject) => {
    chrome.tabGroups.get(groupId, (group) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!group) {
        reject(new Error(`No metadata returned for group ${groupId}.`));
        return;
      }

      resolve(group);
    });
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

  state.isExporting = true;
  setCounter(elements.successCount, 0);
  setCounter(elements.failureCount, 0);
  elements.scanButton.disabled = true;
  elements.exportButton.disabled = true;

  applyModeAndPaths(state.exportPlan);
  renderPreview();

  const result = {
    success: 0,
    failure: 0,
    assetWarnings: 0,
    completedItems: 0,
    totalItems: state.exportPlan.mode === CSV_MODE ? 1 : state.exportPlan.totalEligibleTabs,
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
    logMessage(`Export finished to ${destinationLabel}. ${result.success} succeeded, ${result.failure} failed, ${state.skippedTabs.length} skipped.${warningText}`, result.failure > 0 ? "warning" : "success");
    finishExportProgress(result, result.failure > 0 ? "warning" : "done");
  } catch (error) {
    logMessage(`Export stopped before completion: ${getErrorMessage(error)}`, "error");
    finishExportProgress(result, "error");
  } finally {
    state.isExporting = false;
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

async function exportWithFileSystemAccess(plan, result) {
  const exportRootHandle = await getExportRootDirectory(state.selectedDirectoryHandle);

  if (plan.mode === CSV_MODE) {
    await exportCsvWithFileSystem(exportRootHandle, plan, result);
    return;
  }

  for (const group of plan.groups) {
    let groupDirectoryHandle;

    try {
      groupDirectoryHandle = await exportRootHandle.getDirectoryHandle(group.sanitizedFolderName, {
        create: true
      });
      logMessage(`Opened folder ${group.sanitizedFolderName}.`, "progress");
    } catch (error) {
      const message = `Could not create/open folder ${group.sanitizedFolderName}: ${getErrorMessage(error)}`;
      logMessage(message, "error");
      result.failure += group.files.length;
      setCounter(elements.failureCount, result.failure);
      markExportItemsComplete(result, group.files.length);
      continue;
    }

    for (const file of group.files) {
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
    const blob = await createSingleFileBlob(mode, group, file);
    const finalFileName = await resolveFileName(groupDirectoryHandle, file.fileName);
    await writeBlobToDirectory(groupDirectoryHandle, finalFileName, blob);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${group.sanitizedFolderName}/${finalFileName}.`, "success");
  } catch (error) {
    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function exportCsvWithFileSystem(exportRootHandle, plan, result) {
  try {
    const csvBlob = createCsvBlob(plan);
    const finalFileName = await resolveFileName(exportRootHandle, CSV_FILE_NAME);
    await writeBlobToDirectory(exportRootHandle, finalFileName, csvBlob);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${finalFileName} with ${plan.totalEligibleTabs} grouped tab row(s).`, "success");
  } catch (error) {
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
    if (!usesAssetFolder) {
      const finalFileName = await resolveFileName(groupDirectoryHandle, file.fileName);
      logMessage(`Capturing ${modeLabel} for ${group.sanitizedFolderName}/${finalFileName}.`, "progress");
      const htmlPackage = await createCompleteHtmlPackage(group, file, file.referenceAssetFolderName, mode);
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
    const writeFailures = await writeCompleteHtmlPackage(groupDirectoryHandle, outputNames, htmlPackage);
    const warningCount = htmlPackage.failures.length + writeFailures.length;

    result.success += 1;
    result.assetWarnings += warningCount;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Saved ${group.sanitizedFolderName}/${outputNames.fileName} and ${group.sanitizedFolderName}/${outputNames.assetFolderName}/.`, "success");
    logAssetWarnings(htmlPackage.failures, writeFailures, `${group.sanitizedFolderName}/${outputNames.assetFolderName}`);
  } catch (error) {
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
  if (elements.conflictBehavior.value === "overwrite") {
    await removeEntryIfExists(directoryHandle, requestedFileName);
    return requestedFileName;
  }

  const { baseName, extension } = splitFileName(requestedFileName);
  let candidate = requestedFileName;
  let counter = 1;

  while (await entryExists(directoryHandle, candidate)) {
    candidate = `${baseName} (${counter})${extension}`;
    counter += 1;
  }

  return candidate;
}

async function resolveCompleteOutputNames(directoryHandle, file) {
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
  const assetDirectoryHandle = await groupDirectoryHandle.getDirectoryHandle(outputNames.assetFolderName, {
    create: true
  });

  for (const asset of htmlPackage.assets) {
    try {
      await writeBlobToDirectory(assetDirectoryHandle, asset.fileName, asset.blob);
    } catch (error) {
      writeFailures.push({
        url: asset.url,
        fileName: asset.fileName,
        error: getErrorMessage(error)
      });
    }
  }

  await writeBlobToDirectory(groupDirectoryHandle, outputNames.fileName, htmlPackage.htmlBlob);
  return writeFailures;
}

async function writeBlobToDirectory(directoryHandle, fileName, blob) {
  const fileHandle = await directoryHandle.getFileHandle(fileName, {
    create: true
  });
  const writable = await fileHandle.createWritable({
    keepExistingData: false
  });

  try {
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
  if (plan.mode === CSV_MODE) {
    await exportCsvWithDownloadsFallback(plan, result);
    return;
  }

  if (isHtmlAssetMode(plan.mode)) {
    logMessage("Downloads fallback uses browser conflict handling for each downloaded file; selected-folder export keeps HTML/assets pairs together more reliably.", "warning");
  }

  for (const group of plan.groups) {
    for (const file of group.files) {
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
    const blob = await createSingleFileBlob(mode, group, file);
    const filename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`;
    await downloadBlob(blob, filename);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Queued fallback download ${filename}.`, "success");
  } catch (error) {
    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Fallback failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function exportCsvWithDownloadsFallback(plan, result) {
  try {
    const csvBlob = createCsvBlob(plan);
    const filename = `${ROOT_FOLDER_NAME}/${CSV_FILE_NAME}`;
    await downloadBlob(csvBlob, filename);

    result.success += 1;
    setCounter(elements.successCount, result.success);
    markExportItemsComplete(result);
    logMessage(`Queued fallback download ${filename} with ${plan.totalEligibleTabs} grouped tab row(s).`, "success");
  } catch (error) {
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
    logMessage(`Capturing ${modeLabel} for fallback ${group.sanitizedFolderName}/${file.fileName}.`, "progress");
    const referenceAssetFolderName = usesAssetFolder
      ? file.assetFolderName
      : file.referenceAssetFolderName;
    const htmlPackage = await createCompleteHtmlPackage(group, file, referenceAssetFolderName, mode);
    const htmlFilename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`;
    await downloadBlob(htmlPackage.htmlBlob, htmlFilename);

    if (usesAssetFolder) {
      for (const asset of htmlPackage.assets) {
        const assetFilename = `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.assetFolderName}/${asset.fileName}`;
        try {
          await downloadBlob(asset.blob, assetFilename);
        } catch (error) {
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
    result.failure += 1;
    setCounter(elements.failureCount, result.failure);
    markExportItemsComplete(result);
    logMessage(`Fallback ${modeLabel} failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
  }
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    await downloadBlobUrl(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

function downloadBlobUrl(url, filename) {
  const conflictAction = elements.conflictBehavior.value === "overwrite" ? "overwrite" : "uniquify";

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      conflictAction,
      saveAs: false
    }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (typeof downloadId !== "number") {
        reject(new Error("The browser did not return a download ID."));
        return;
      }

      resolve(downloadId);
    });
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
  const exportedAt = new Date().toISOString();
  const rows = [[
    "exported_at",
    "group_order",
    "group_id",
    "group_name",
    "tab_order_in_group",
    "tab_index",
    "tab_id",
    "page_title",
    "page_url"
  ]];

  plan.groups.forEach((group, groupIndex) => {
    group.files.forEach((file) => {
      rows.push([
        exportedAt,
        String(groupIndex + 1),
        String(group.groupId),
        group.originalTitle,
        String(file.order),
        String(file.tabIndex),
        String(file.tabId),
        cleanCsvPageTitle(file.title),
        file.url
      ]);
    });
  });

  return rows.map((row) => row.map(formatCsvCell).join(",")).join("\r\n") + "\r\n";
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
  const serializerAssetMode = getHtmlSerializerAssetMode(mode);
  const fetchAssetMode = getHtmlFetchAssetMode(mode);
  const capturedPage = await captureCompleteHtmlSnapshot(file.tabId, assetFolderName, serializerAssetMode);
  const context = createAssetContext(assetFolderName, fetchAssetMode);

  if (shouldDownloadHtmlAssets(mode)) {
    for (const resource of capturedPage.resources) {
      await ensureAsset(resource.url, resource.fileName, resource.kind, context);
    }
  }

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
    "HTML export requires the scripting API or the background serializer. Reload TabGroupVault at edge://extensions after updating the extension, then reopen TabGroupVault."
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

  return new Promise((resolve, reject) => {
    scriptingApiInfo.api.executeScript(executeOptions, (results) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      const firstResult = Array.isArray(results) ? results[0] : null;
      const capturedPage = firstResult ? firstResult.result : null;
      resolve(capturedPage);
    });
  });
}

function executeSerializerWithLegacyTabsApi(tabId, options) {
  return new Promise((resolve, reject) => {
    const code = `(${serializeCompleteHtmlInPage.toString()})(${JSON.stringify(options)})`;
    chrome.tabs.executeScript(tabId, {
      code,
      runAt: "document_idle"
    }, (results) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(Array.isArray(results) ? results[0] : null);
    });
  });
}

function executeSerializerWithBackground(tabId, options) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: RUN_SERIALIZER_IN_TAB_MESSAGE,
      tabId,
      options
    }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(formatBackgroundSerializerError(error.message)));
        return;
      }

      if (!response) {
        reject(new Error("The background serializer returned no response."));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "The background serializer failed."));
        return;
      }

      resolve(response.result || null);
    });
  });
}

function formatBackgroundSerializerError(message) {
  const details = String(message || "").trim();
  if (/receiving end does not exist/i.test(details)) {
    return "The background serializer is not available. Reload TabGroupVault at edge://extensions, then reopen TabGroupVault.";
  }

  return details
    ? `The background serializer failed: ${details}`
    : "The background serializer failed.";
}

function serializeCompleteHtmlInPage(options) {
  const assetMode = options.assetMode || "all";
  const shouldLocalizeAssets = assetMode !== "none";
  const shouldUseFallbackExtensions = assetMode === "all";
  const shouldRewriteEmbeddedCssAsAssets = assetMode === "all";
  const assetFolderName = options.assetFolderName || "";
  const sourceUrl = window.location.href;
  const baseUrl = document.baseURI || sourceUrl;
  const clone = document.documentElement.cloneNode(true);
  const resourcesByUrl = new Map();
  const usedFileNames = new Set();

  function shouldSkipUrl(rawUrl) {
    if (!rawUrl) {
      return true;
    }

    const trimmed = String(rawUrl).trim();
    const lower = trimmed.toLowerCase();
    return !trimmed ||
      trimmed.startsWith("#") ||
      lower.startsWith("data:") ||
      lower.startsWith("blob:") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("about:");
  }

  function resolveUrl(rawUrl) {
    if (shouldSkipUrl(rawUrl)) {
      return null;
    }

    try {
      const absoluteUrl = new URL(rawUrl, baseUrl);
      if (absoluteUrl.protocol !== "http:" && absoluteUrl.protocol !== "https:") {
        return null;
      }

      return absoluteUrl.href;
    } catch (_error) {
      return null;
    }
  }

  function addResource(rawUrl, kind) {
    if (!shouldLocalizeAssets) {
      return null;
    }

    const absoluteUrl = resolveUrl(rawUrl);
    if (!absoluteUrl) {
      return null;
    }

    if (resourcesByUrl.has(absoluteUrl)) {
      return resourcesByUrl.get(absoluteUrl).localPath;
    }

    const fileName = allocateAssetFileName(absoluteUrl, kind);
    const localPath = `./${assetFolderName}/${fileName}`;
    resourcesByUrl.set(absoluteUrl, {
      url: absoluteUrl,
      fileName,
      localPath,
      kind
    });
    return localPath;
  }

  function makeAbsoluteResourceUrl(rawUrl) {
    return resolveUrl(rawUrl);
  }

  function allocateAssetFileName(absoluteUrl, kind) {
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
    } else if (!candidate.includes(".") && fallbackExtension && shouldUseFallbackExtensions) {
      candidate = `${candidate}${fallbackExtension}`;
    }

    candidate = trimAssetFileName(candidate);
    return uniquifyAssetFileName(candidate);
  }

  function sanitizeAssetFileName(fileName) {
    const sanitized = String(fileName)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/^\.+/g, "")
      .replace(/[.\s]+$/g, "")
      .trim();
    return isReservedAssetFileName(sanitized) ? `${sanitized}_asset` : sanitized;
  }

  function isReservedAssetFileName(fileName) {
    return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(fileName);
  }

  function trimAssetFileName(fileName) {
    if (fileName.length <= 120) {
      return fileName;
    }

    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex > fileName.length - 16) {
      const extension = fileName.slice(dotIndex);
      return fileName.slice(0, 120 - extension.length).replace(/[.\s]+$/g, "") + extension;
    }

    return fileName.slice(0, 120).replace(/[.\s]+$/g, "");
  }

  function uniquifyAssetFileName(fileName) {
    const splitName = splitFileName(fileName || "asset");
    let candidate = fileName || "asset";
    let counter = 1;

    while (usedFileNames.has(candidate.toLowerCase())) {
      candidate = `${splitName.baseName} (${counter})${splitName.extension}`;
      candidate = trimAssetFileName(candidate);
      counter += 1;
    }

    usedFileNames.add(candidate.toLowerCase());
    return candidate;
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

  function setLocalResource(element, attrName, localPath) {
    element.setAttribute(attrName, localPath);
    element.removeAttribute("integrity");
    element.removeAttribute("crossorigin");
  }

  function setAbsoluteResource(element, attrName, absoluteUrl) {
    element.setAttribute(attrName, absoluteUrl);
  }

  function rewriteUrlAttribute(selector, attrName, kind) {
    for (const element of clone.querySelectorAll(selector)) {
      const rawValue = element.getAttribute(attrName);
      if (!shouldLocalizeAssets) {
        const absoluteUrl = makeAbsoluteResourceUrl(rawValue);
        if (absoluteUrl) {
          setAbsoluteResource(element, attrName, absoluteUrl);
        }
        continue;
      }

      const localPath = addResource(rawValue, kind);
      if (localPath) {
        setLocalResource(element, attrName, localPath);
      }
    }
  }

  function rewriteSrcsetAttribute(selector, attrName, kind) {
    for (const element of clone.querySelectorAll(selector)) {
      const rawValue = element.getAttribute(attrName);
      const rewritten = shouldLocalizeAssets
        ? rewriteSrcset(rawValue, kind)
        : makeAbsoluteSrcset(rawValue);
      if (rewritten && rewritten !== rawValue) {
        element.setAttribute(attrName, rewritten);
        if (shouldLocalizeAssets) {
          element.removeAttribute("integrity");
          element.removeAttribute("crossorigin");
        }
      }
    }
  }

  function rewriteSrcset(srcset, kind) {
    if (!srcset) {
      return srcset;
    }

    return srcset.split(",").map((entry) => {
      const trimmedEntry = entry.trim();
      if (!trimmedEntry) {
        return trimmedEntry;
      }

      const parts = trimmedEntry.split(/\s+/);
      const urlPart = parts.shift();
      const localPath = addResource(urlPart, kind);
      if (!localPath) {
        return trimmedEntry;
      }

      return [localPath, ...parts].join(" ");
    }).join(", ");
  }

  function makeAbsoluteSrcset(srcset) {
    if (!srcset) {
      return srcset;
    }

    return srcset.split(",").map((entry) => {
      const trimmedEntry = entry.trim();
      if (!trimmedEntry) {
        return trimmedEntry;
      }

      const parts = trimmedEntry.split(/\s+/);
      const urlPart = parts.shift();
      const absoluteUrl = makeAbsoluteResourceUrl(urlPart);
      if (!absoluteUrl) {
        return trimmedEntry;
      }

      return [absoluteUrl, ...parts].join(" ");
    }).join(", ");
  }

  function rewriteInlineCss(cssText) {
    if (!cssText) {
      return cssText;
    }

    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, rawUrl) => {
      if (!shouldLocalizeAssets || !shouldRewriteEmbeddedCssAsAssets) {
        const absoluteUrl = makeAbsoluteResourceUrl(rawUrl);
        return absoluteUrl ? `url("${absoluteUrl}")` : match;
      }

      const localPath = addResource(rawUrl, "asset");
      return localPath ? `url("${localPath}")` : match;
    });
  }

  function makeAbsoluteDocumentUrl(rawUrl) {
    if (shouldSkipUrl(rawUrl)) {
      return rawUrl;
    }

    try {
      return new URL(rawUrl, baseUrl).href;
    } catch (_error) {
      return rawUrl;
    }
  }

  function removeUploadFromMobileOption() {
    const removableSelectors = [
      "button",
      "a",
      "li",
      "[role='button']",
      "[role='menuitem']",
      "[role='option']",
      "[aria-label]",
      "[title]"
    ].join(",");

    for (const element of Array.from(clone.querySelectorAll(removableSelectors))) {
      const visibleText = normalizeControlText(element.textContent);
      const ariaLabel = normalizeControlText(element.getAttribute("aria-label"));
      const title = normalizeControlText(element.getAttribute("title"));

      if (visibleText === "upload from mobile" ||
        ariaLabel === "upload from mobile" ||
        title === "upload from mobile") {
        element.remove();
      }
    }
  }

  function normalizeControlText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  removeUploadFromMobileOption();
  clone.querySelectorAll("base").forEach((element) => element.remove());

  rewriteUrlAttribute("img[src]", "src", "image");
  rewriteUrlAttribute("script[src]", "src", "script");
  rewriteUrlAttribute("video[src]", "src", "media");
  rewriteUrlAttribute("audio[src]", "src", "media");
  rewriteUrlAttribute("source[src]", "src", "media");
  rewriteUrlAttribute("track[src]", "src", "media");
  rewriteUrlAttribute("iframe[src]", "src", "frame");
  rewriteUrlAttribute("embed[src]", "src", "frame");
  rewriteUrlAttribute("object[data]", "data", "frame");
  rewriteUrlAttribute("input[type='image'][src]", "src", "image");
  rewriteUrlAttribute("[poster]", "poster", "image");
  rewriteSrcsetAttribute("img[srcset]", "srcset", "image");
  rewriteSrcsetAttribute("source[srcset]", "srcset", "image");

  for (const link of clone.querySelectorAll("link[href]")) {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const asValue = (link.getAttribute("as") || "").toLowerCase();
    let kind = "";

    if (rel.includes("stylesheet")) {
      kind = "style";
    } else if (rel.includes("manifest")) {
      kind = "manifest";
    } else if (rel.includes("icon") || rel.includes("apple-touch-icon") || rel.includes("mask-icon")) {
      kind = "image";
    } else if (assetMode === "all" && (rel.includes("preload") || rel.includes("modulepreload") || rel.includes("prefetch"))) {
      kind = asValue === "style" ? "style" : asValue === "script" ? "script" : "asset";
    }

    if (kind) {
      if (!shouldLocalizeAssets) {
        const absoluteUrl = makeAbsoluteResourceUrl(link.getAttribute("href"));
        if (absoluteUrl) {
          setAbsoluteResource(link, "href", absoluteUrl);
        }
      } else {
        const localPath = addResource(link.getAttribute("href"), kind);
        if (localPath) {
          setLocalResource(link, "href", localPath);
        }
      }
    }
  }

  if (!shouldLocalizeAssets) {
    for (const link of clone.querySelectorAll("link[href]")) {
      const absoluteUrl = makeAbsoluteResourceUrl(link.getAttribute("href"));
      if (absoluteUrl) {
        setAbsoluteResource(link, "href", absoluteUrl);
      }
    }
  }

  for (const element of clone.querySelectorAll("[style]")) {
    const rawStyle = element.getAttribute("style");
    const rewrittenStyle = rewriteInlineCss(rawStyle);
    if (rewrittenStyle !== rawStyle) {
      element.setAttribute("style", rewrittenStyle);
    }
  }

  for (const styleElement of clone.querySelectorAll("style")) {
    styleElement.textContent = rewriteInlineCss(styleElement.textContent || "");
  }

  for (const anchor of clone.querySelectorAll("a[href], area[href]")) {
    anchor.setAttribute("href", makeAbsoluteDocumentUrl(anchor.getAttribute("href")));
  }

  for (const form of clone.querySelectorAll("form[action]")) {
    form.setAttribute("action", makeAbsoluteDocumentUrl(form.getAttribute("action")));
  }

  const doctype = document.doctype
    ? `<!DOCTYPE ${document.doctype.name}>`
    : "<!DOCTYPE html>";
  const escapedSource = sourceUrl.replace(/--/g, "- -");
  const html = `${doctype}\n<!-- saved from url=(${sourceUrl.length})${escapedSource} -->\n${clone.outerHTML}\n`;

  return {
    title: document.title || sourceUrl,
    url: sourceUrl,
    html,
    resources: Array.from(resourcesByUrl.values())
  };
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
  const response = await fetch(absoluteUrl, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
  }

  const contentType = response.headers.get("content-type") || "";

  if (kind === "style" || looksLikeCssAsset(absoluteUrl, contentType)) {
    const cssText = await response.text();
    const rewrittenCss = context.assetMode === HTML_ASSET_ALL
      ? await rewriteCssAssetUrls(cssText, absoluteUrl, context)
      : absolutizeCssAssetUrls(cssText, absoluteUrl);
    return new Blob([rewrittenCss], {
      type: contentType || "text/css;charset=utf-8"
    });
  }

  return response.blob();
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
  const absoluteUrl = resolveNestedAssetUrl(rawUrl, cssUrl);
  if (!absoluteUrl) {
    return originalText;
  }

  const localFileName = await ensureAsset(absoluteUrl, null, kind, context);
  return localFileName ? `url("${escapeCssString(localFileName)}")` : originalText;
}

async function makeCssImportLocalUrl(originalText, rawUrl, cssUrl, context) {
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
    `TabGroupVault ${getHtmlModeLogLabel(mode)} export`,
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
  return new Promise((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (blob) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!(blob instanceof Blob)) {
        reject(new Error("MHTML capture did not return a Blob."));
        return;
      }

      resolve(blob);
    });
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
  const mode = getSelectedMode();
  const extension = mode === MHTML_MODE ? "mhtml" : "html";
  plan.mode = mode;
  plan.csvFileName = CSV_FILE_NAME;
  plan.csvRelativePath = mode === CSV_MODE ? buildRootRelativePath(CSV_FILE_NAME) : "";

  for (const group of plan.groups) {
    for (const file of group.files) {
      file.outputExtension = mode === CSV_MODE ? "" : extension;
      file.baseFileName = String(file.order);
      file.fileName = mode === CSV_MODE ? "" : `${file.baseFileName}.${extension}`;
      file.referenceAssetFolderName = isHtmlLocalReferenceMode(mode) || isHtmlAssetMode(mode)
        ? `${file.baseFileName}_files`
        : "";
      file.assetFolderName = isHtmlAssetMode(mode) ? file.referenceAssetFolderName : "";
      file.plannedRelativePath = file.fileName
        ? buildPlannedRelativePath(group.sanitizedFolderName, file.fileName)
        : "";
      file.plannedReferenceAssetFolderPath = isHtmlLocalReferenceMode(mode)
        ? buildPlannedRelativePath(group.sanitizedFolderName, `${file.referenceAssetFolderName}/`)
        : "";
      file.plannedAssetFolderPath = file.assetFolderName
        ? buildPlannedRelativePath(group.sanitizedFolderName, `${file.assetFolderName}/`)
        : "";
    }
  }
}

function buildPlannedRelativePath(groupFolderName, fileName) {
  if (isDownloadsFallbackSelected() || elements.createRootFolder.checked) {
    return `${ROOT_FOLDER_NAME}/${groupFolderName}/${fileName}`;
  }

  return `${groupFolderName}/${fileName}`;
}

function buildRootRelativePath(fileName) {
  if (isDownloadsFallbackSelected() || elements.createRootFolder.checked) {
    return `${ROOT_FOLDER_NAME}/${fileName}`;
  }

  return fileName;
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

    const path = document.createElement("p");
    path.className = "path";
    path.textContent = state.exportPlan.csvRelativePath;
    csvBlock.append(path);

    const details = document.createElement("p");
    details.className = "muted";
    details.textContent = `${state.exportPlan.totalEligibleTabs} grouped HTTP/HTTPS tab row(s), with group, order, cleaned page title, URL, tab index, and tab ID.`;
    csvBlock.append(details);

    fragment.append(csvBlock);
    elements.preview.append(fragment);
    return;
  }

  for (const group of state.exportPlan.groups) {
    const groupBlock = document.createElement("div");
    groupBlock.className = "group-preview";

    const heading = document.createElement("h3");
    heading.textContent = `${group.originalTitle} -> ${group.sanitizedFolderName}`;
    groupBlock.append(heading);

    const list = document.createElement("ul");
    for (const file of group.files) {
      const item = document.createElement("li");
      const path = document.createElement("span");
      path.className = "path";
      path.textContent = file.plannedRelativePath;

      const details = document.createElement("span");
      details.className = "muted";
      details.textContent = ` - ${file.title}`;

      item.append(path, details);

      if (file.plannedAssetFolderPath) {
        const assetPath = document.createElement("div");
        assetPath.className = "path muted";
        assetPath.textContent = `${file.plannedAssetFolderPath} ${getAssetFolderPreviewLabel(state.exportPlan.mode)}`;
        item.append(assetPath);
      }

      if (file.plannedReferenceAssetFolderPath) {
        const referencePath = document.createElement("div");
        referencePath.className = "path muted";
        referencePath.textContent = `${file.plannedReferenceAssetFolderPath} referenced by HTML only; folder is not downloaded`;
        item.append(referencePath);
      }

      list.append(item);
    }

    groupBlock.append(list);
    fragment.append(groupBlock);
  }

  elements.preview.append(fragment);
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
  const hasSelectedFolder = Boolean(state.selectedDirectoryHandle && state.selectedDirectoryWritable);
  const hasDestination = hasSelectedFolder || isDownloadsFallbackSelected();
  elements.exportButton.disabled = state.isExporting || !hasPlan || !hasDestination;
}

function updateScanCounters(plan) {
  setCounter(elements.eligibleCount, plan.totalEligibleTabs);
  setCounter(elements.skippedCount, plan.skippedTabs.length);
  elements.skippedSummaryText.textContent = `(${plan.skippedTabs.length})`;
}

function resetCounters() {
  setCounter(elements.eligibleCount, 0);
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
      : "Export stopped before all items were concluded.";
  updateExportProgress(result, statusText);
  elements.exportProgressPanel.classList.toggle("done", state === "done");
  elements.exportProgressPanel.classList.toggle("warning", state === "warning");
  elements.exportProgressPanel.classList.toggle("error", state === "error");
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
