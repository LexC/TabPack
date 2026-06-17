// @ts-check
"use strict";

/**
 * Entry point for the TabPack export page. It wires shared helpers, page state,
 * rendering, destination handling, and export writers without introducing a build step.
 */
(function initializeTabPackExportPage(root) {
  const constants = root.TabPackConstants;
  const browserApi = root.TabPackBrowserApi;
  const ExportHelpers = root.TabPackExportHelpers;

  const {
    ROOT_FOLDER_NAME,
    HTML_PAGE_MODE,
    HTML_LOCAL_ASSET_PATHS_MODE,
    HTML_RELEVANT_ASSETS_MODE,
    HTML_ALL_ASSETS_MODE,
    CSV_MODE,
    MHTML_MODE
  } = constants;

  const { queryTabs, getTabGroup: getTabGroupById, storageGet, storageSet, permissionsContains } = browserApi;

  const EXPORT_PREFERENCES_KEY = "exportPreferences";
  const NO_GROUP_ID = chrome.tabGroups && typeof chrome.tabGroups.TAB_GROUP_ID_NONE === "number"
    ? chrome.tabGroups.TAB_GROUP_ID_NONE
    : -1;

  /*
   * Page state is deliberately centralized here because the export screen is a
   * single long-lived document. Feature modules receive this object through the
   * context instead of keeping parallel state that can drift during rescans,
   * selection changes, or an in-progress export.
   */
  /** @type {TabPackExportState} */
  const state = {
    selectedDirectoryHandle: null,
    selectedDirectoryWritable: false,
    exportPlan: null,
    skippedTabs: [],
    isExporting: false,
    stopRequested: false,
    exportAbortController: null,
    preferencesLoaded: false,
    optionalHostPermissionsGranted: false,
    latestExportResult: null
  };

  /** @type {TabPackExportElements} */
  const elements = {};

  /*
   * Shared dependency bag for the plain-script modules.
   *
   * This replaces what imports would normally provide in a bundled app while
   * preserving the extension's direct script-tag architecture.
   */
  /** @type {TabPackExportContext} */
  const context = {
    constants,
    browserApi,
    ExportHelpers,
    state,
    elements,
    getPathOptions,
    getSelectedMode,
    isDownloadsFallbackSelected,
    shouldExportCsvReport,
    getCsvSelectedRowCount,
    buildPlannedRelativePath,
    throwIfExportStopped,
    isExportStopError,
    getErrorMessage,
    isUserCancellation,
    refreshPlanDisplay,
    applyModeAndPaths,
    saveExportPreferences,
    hasRetryableFailedTabs,
    renderer: null,
    destination: null,
    htmlCapture: null,
    writer: null
  };

  const htmlCapture = root.TabPackHtmlCapture.create(context);
  const renderer = root.TabPackExportRenderer.create(context);
  const destination = root.TabPackExportDestination.create(context);
  const writer = root.TabPackExportWriter.create(context);
  context.htmlCapture = htmlCapture;
  context.renderer = renderer;
  context.destination = destination;
  context.writer = writer;

  /*
   * Boot only after the DOM exists because every module renders through the
   * element cache populated by `bindElements()`.
   */
  document.addEventListener("DOMContentLoaded", () => {
    bindElements();
    bindEvents();
    initializeExportPage().catch((error) => {
      renderer.logMessage("TabPack initialization warning: " + getErrorMessage(error), "warning");
      destination.initializeDestinationUi();
      renderer.resetCounters();
      renderer.setExportProgressIdle("Export progress will appear here when an export starts.");
      renderer.updateExportAvailability();
    }).finally(() => {
      elements.scanButton.disabled = false;
    });
  });

  /** @param {string} id */
  function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing export page element: ${id}`);
    }

    return element;
  }

  /** @param {string} id */
  function getButtonElement(id) {
    return /** @type {HTMLButtonElement} */ (getElement(id));
  }

  /** @param {string} id */
  function getInputElement(id) {
    return /** @type {HTMLInputElement} */ (getElement(id));
  }

  /**
   * Cache all DOM nodes used by the page.
   *
   * Failing fast on a missing element is preferable to a partially initialized
   * export page, because a stale ID would otherwise show up later as an unrelated
   * export failure.
   */
  function bindElements() {
    elements.scanButton = getButtonElement("scanButton");
    elements.exportButton = getButtonElement("exportButton");
    elements.retryFailedButton = getButtonElement("retryFailedButton");
    elements.stopExportButton = getButtonElement("stopExportButton");
    elements.chooseFolderButton = getButtonElement("chooseFolderButton");
    elements.selectedFolderText = getElement("selectedFolderText");
    elements.createRootFolder = getInputElement("createRootFolder");
    elements.fallbackPanel = getElement("fallbackPanel");
    elements.fallbackMessage = getElement("fallbackMessage");
    elements.useDownloadsFallback = getInputElement("useDownloadsFallback");
    elements.exportReportCsv = getInputElement("exportReportCsv");
    elements.filenameMode = getInputElement("filenameMode");
    elements.filenameModeButtons = /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll("[data-filename-mode-value]")));
    elements.preserveOriginalNumbers = getInputElement("preserveOriginalNumbers");
    elements.closeTabsAfterExport = getInputElement("closeTabsAfterExport");
    elements.conflictBehavior = getInputElement("conflictBehavior");
    elements.conflictButtons = /** @type {HTMLButtonElement[]} */ (Array.from(document.querySelectorAll("[data-conflict-value]")));
    elements.preview = getElement("preview");
    elements.skippedTabs = getElement("skippedTabs");
    elements.skippedSummaryText = getElement("skippedSummaryText");
    elements.exportProgressPanel = getElement("exportProgressPanel");
    elements.exportProgressPercent = getElement("exportProgressPercent");
    elements.exportProgressBar = getElement("exportProgressBar");
    elements.exportProgressTrack = elements.exportProgressBar.parentElement;
    elements.exportProgressDetail = getElement("exportProgressDetail");
    elements.progressLog = getElement("progressLog");
    elements.eligibleCount = getElement("eligibleCount");
    elements.skippedCount = getElement("skippedCount");
    elements.successCount = getElement("successCount");
    elements.failureCount = getElement("failureCount");
    elements.selectedCount = getElement("selectedCount");
    elements.modeInputs = Array.from(document.querySelectorAll("input[name='exportMode']"));
  }

  /**
   * Attach UI events after the modules are created so event handlers can call the
   * destination, writer, and renderer APIs through stable references.
   */
  function bindEvents() {
    elements.scanButton.addEventListener("click", scanGroupedTabs);
    elements.exportButton.addEventListener("click", exportGroupedTabs);
    elements.retryFailedButton.addEventListener("click", retryFailedTabs);
    elements.stopExportButton.addEventListener("click", stopExport);
    elements.chooseFolderButton.addEventListener("click", destination.chooseOutputFolder);
    elements.createRootFolder.addEventListener("change", () => {
      saveExportPreferences();
      refreshPlanDisplay();
    });
    elements.useDownloadsFallback.addEventListener("change", () => {
      saveExportPreferences();
      renderer.updateExportAvailability();
      refreshPlanDisplay();
    });
    elements.exportReportCsv.addEventListener("change", () => {
      saveExportPreferences();
      renderer.updateExportAvailability();
      refreshPlanDisplay();
    });
    elements.preserveOriginalNumbers.addEventListener("change", () => {
      saveExportPreferences();
      refreshPlanDisplay();
    });
    elements.closeTabsAfterExport.addEventListener("change", saveExportPreferences);

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

    for (const button of elements.filenameModeButtons) {
      button.addEventListener("click", () => {
        setFilenameMode(button.dataset.filenameModeValue);
        saveExportPreferences();
        refreshPlanDisplay();
      });
    }
  }

  /**
   * Restore preference state, discover destination capability, and render the
   * idle page. This is intentionally separate from scanning so startup never
   * performs tab access work until the user asks for it.
   */
  async function initializeExportPage() {
    await loadExportPreferences();
    refreshOptionalHostPermissionState();
    destination.initializeDestinationUi();
    await destination.restoreRememberedOutputFolder();
    renderer.resetCounters();
    renderer.setExportProgressIdle("Export progress will appear here when an export starts.");
    renderer.updateExportAvailability();
  }

  /**
   * Cache optional host permission state for the first export attempt.
   *
   * The writer still rechecks when a permission request is denied, because
   * browsers can report already-granted permissions differently after updates.
   */
  function refreshOptionalHostPermissionState() {
    permissionsContains({
      origins: ExportHelpers.getOptionalHostOrigins()
    }).then((granted) => {
      state.optionalHostPermissionsGranted = granted;
    }).catch((_error) => {
      state.optionalHostPermissionsGranted = false;
    });
  }

  /**
   * Request cooperative cancellation.
   *
   * Browser APIs are not all abortable, so the export loop checks this flag
   * between each awaited operation and uses AbortController only where fetch
   * supports it.
   */
  function stopExport() {
    if (!state.isExporting || state.stopRequested) {
      return;
    }

    state.stopRequested = true;
    if (state.exportAbortController) {
      state.exportAbortController.abort();
    }
    renderer.updateExportAvailability();
    renderer.logMessage("Stop requested. TabPack will stop after the current in-flight browser operation ends.", "warning");
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

  function setFilenameMode(value) {
    const mode = value === "title" ? "title" : "numbered";
    elements.filenameMode.value = mode;

    for (const button of elements.filenameModeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.filenameModeValue === mode));
    }
  }

  /**
   * Apply saved UI preferences after validating each value against known modes
   * and option sets. Unknown values are ignored so old storage cannot break a
   * newer extension page.
   */
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

      if (typeof preferences.exportReportCsv === "boolean") {
        elements.exportReportCsv.checked = preferences.exportReportCsv;
      }

      if (preferences.filenameMode === "numbered" || preferences.filenameMode === "title") {
        setFilenameMode(preferences.filenameMode);
      }

      if (typeof preferences.preserveOriginalNumbers === "boolean") {
        elements.preserveOriginalNumbers.checked = preferences.preserveOriginalNumbers;
      }

      if (typeof preferences.closeTabsAfterExport === "boolean") {
        elements.closeTabsAfterExport.checked = preferences.closeTabsAfterExport;
      }

    } catch (error) {
      renderer.logMessage(`Could not load saved export preferences: ${getErrorMessage(error)}`, "warning");
    } finally {
      state.preferencesLoaded = true;
    }
  }

  /** Persist lightweight UI preferences after initial preference load finishes. */
  function saveExportPreferences() {
    if (!state.preferencesLoaded) {
      return;
    }

    storageSet({
      [EXPORT_PREFERENCES_KEY]: {
        mode: getSelectedMode(),
        conflictBehavior: elements.conflictBehavior.value,
        filenameMode: elements.filenameMode.value,
        preserveOriginalNumbers: elements.preserveOriginalNumbers.checked,
        closeTabsAfterExport: elements.closeTabsAfterExport.checked,
        exportReportCsv: elements.exportReportCsv.checked,
        createRootFolder: elements.createRootFolder.checked,
        useDownloadsFallback: elements.useDownloadsFallback.checked
      }
    }).catch((error) => {
      renderer.logMessage(`Could not save export preferences: ${getErrorMessage(error)}`, "warning");
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

  /**
   * Build a fresh export plan for the current window and render the preview.
   *
   * Scanning does not write files or request host permissions. It only reads tab
   * and group metadata so users can review and adjust the selection first.
   */
  async function scanGroupedTabs() {
    elements.scanButton.disabled = true;
    elements.exportButton.disabled = true;
    state.exportPlan = null;
    state.skippedTabs = [];
    state.latestExportResult = null;
    renderer.setCounter(elements.successCount, 0);
    renderer.setCounter(elements.failureCount, 0);
    renderer.setExportProgressIdle("Scan in progress. Export progress will appear when an export starts.");
    renderer.clearPreview("Scanning grouped tabs...");
    renderer.clearSkippedTabs();
    renderer.logMessage("Starting scan of the current browser window for grouped HTTP/HTTPS tabs.", "start");

    try {
      const tabs = await queryCurrentWindowTabs();
      const plan = await buildExportPlan(tabs);
      state.exportPlan = plan;
      state.skippedTabs = plan.skippedTabs;
      renderer.updateScanCounters(plan);
      renderer.renderPreview();
      renderer.renderSkippedTabs();

      if (plan.totalEligibleTabs === 0) {
        renderer.logMessage("Scan finished. No eligible grouped HTTP/HTTPS tabs were found.", "warning");
      } else {
        renderer.logMessage(`Scan finished. ${plan.totalEligibleTabs} eligible grouped tab(s), ${plan.totalSelectedTabs} selected by default, ${plan.skippedTabs.length} skipped.`, "success");
      }
    } catch (error) {
      renderer.clearPreview("Scan failed.");
      renderer.logMessage(`Scan failed: ${getErrorMessage(error)}`, "error");
    } finally {
      elements.scanButton.disabled = false;
      renderer.updateExportAvailability();
    }
  }

  function queryCurrentWindowTabs() {
    return queryTabs({ currentWindow: true });
  }

  /**
   * Fetch group metadata for the tabs that are actually grouped, then delegate
   * all pure planning to `TabPackExportHelpers`.
   */
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
        renderer.logMessage(`Could not read metadata for tab group ${groupId}: ${getErrorMessage(error)}`, "warning");
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

  /**
   * Main export orchestration.
   *
   * This function handles validation, permission prompts, progress/result state,
   * and destination selection. Actual file writes are delegated to the writer so
   * this entrypoint remains a readable lifecycle.
   */
  async function exportGroupedTabs() {
    if (!state.exportPlan || state.exportPlan.totalEligibleTabs === 0) {
      renderer.logMessage("Export is unavailable until grouped tabs have been scanned.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    applyModeAndPaths(state.exportPlan);

    if (state.exportPlan.totalSelectedTabs === 0) {
      renderer.logMessage("Select at least one grouped HTTP/HTTPS tab before exporting.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    if (state.exportPlan.mode === CSV_MODE && !shouldExportCsvReport()) {
      renderer.logMessage("Enable Export report CSV before exporting CSV page index.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    await runExport(state.exportPlan, {
      includeCsvReport: true,
      retry: false
    });
  }

  async function retryFailedTabs() {
    if (!state.exportPlan || state.exportPlan.totalEligibleTabs === 0) {
      renderer.logMessage("Retry is unavailable until grouped tabs have been scanned.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    applyModeAndPaths(state.exportPlan);

    if (state.exportPlan.mode === CSV_MODE) {
      renderer.logMessage("Retry failed tabs is only available for page export modes.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    const failedSelectionKeys = getRetryableFailedSelectionKeys();
    if (failedSelectionKeys.size === 0) {
      renderer.logMessage("No failed tab exports are available to retry.", "warning");
      renderer.updateExportAvailability();
      return;
    }

    const retryPlan = buildRetryPlan(failedSelectionKeys);
    await runExport(retryPlan, {
      includeCsvReport: false,
      retry: true
    });
  }

  /**
   * Run either a normal export or a failed-tab retry through the same lifecycle.
   * Retry plans are temporary and do not mutate the preview selection.
   */
  async function runExport(plan, options = {}) {
    const includeCsvReport = options.includeCsvReport !== false;

    try {
      await writer.ensureOptionalPermissionsForExport(plan, {
        downloadsFallback: isDownloadsFallbackSelected()
      });
    } catch (error) {
      renderer.logMessage(getErrorMessage(error), "error");
      renderer.updateExportAvailability();
      return;
    }

    state.isExporting = true;
    state.stopRequested = false;
    state.latestExportResult = null;
    state.exportAbortController = typeof AbortController === "function"
      ? new AbortController()
      : null;
    renderer.setCounter(elements.successCount, 0);
    renderer.setCounter(elements.failureCount, 0);
    elements.scanButton.disabled = true;
    renderer.updateExportAvailability();

    if (!options.retry) {
      renderer.renderPreview();
    }

    const result = {
      exportedAt: new Date().toISOString(),
      success: 0,
      failure: 0,
      assetWarnings: 0,
      completedItems: 0,
      totalItems: writer.getExportProgressItemCount(plan, {
        includeCsvReport
      }),
      progressUnit: "item",
      pageResults: []
    };
    renderer.resetExportProgress(result.totalItems, result.progressUnit);

    try {
      if (isDownloadsFallbackSelected()) {
        renderer.logMessage(`${options.retry ? "Retrying failed tabs with" : "Starting"} Downloads fallback export to Downloads/${ROOT_FOLDER_NAME}/.`, "start");
        await writer.exportWithDownloadsFallback(plan, result, {
          includeCsvReport
        });
      } else {
        await destination.ensureSelectedDirectoryReady();
        renderer.logMessage(`${options.retry ? "Retrying failed tabs with" : "Starting"} selected-folder export with the File System Access API.`, "start");
        await writer.exportWithFileSystemAccess(plan, result, {
          includeCsvReport
        });
      }

      const destinationLabel = isDownloadsFallbackSelected()
        ? `Downloads/${ROOT_FOLDER_NAME}/ fallback`
        : "selected output folder";
      const warningText = result.assetWarnings > 0
        ? ` ${result.assetWarnings} asset warning(s).`
        : "";
      const skippedText = options.retry
        ? ""
        : `, ${plan.totalDeselectedTabs} deselected, ${state.skippedTabs.length} skipped`;
      const actionLabel = options.retry ? "Retry" : "Export";
      if (state.stopRequested) {
        renderer.logMessage(`${actionLabel} stopped by user. ${result.success} item(s) succeeded, ${result.failure} failed${skippedText}.${warningText}`, "warning");
        renderer.finishExportProgress(result, "stopped");
      } else {
        renderer.logMessage(`${actionLabel} finished to ${destinationLabel}. ${result.success} item(s) succeeded, ${result.failure} failed${skippedText}.${warningText}`, result.failure > 0 ? "warning" : "success");
        renderer.finishExportProgress(result, result.failure > 0 ? "warning" : "done");
      }
    } catch (error) {
      const actionLabel = options.retry ? "Retry" : "Export";
      const skippedText = options.retry
        ? ""
        : `, ${plan.totalDeselectedTabs} deselected, ${state.skippedTabs.length} skipped`;
      if (isExportStopError(error)) {
        renderer.logMessage(`${actionLabel} stopped by user. ${result.success} item(s) succeeded, ${result.failure} failed${skippedText}.`, "warning");
        renderer.finishExportProgress(result, "stopped");
      } else {
        renderer.logMessage(`${actionLabel} stopped before completion: ${getErrorMessage(error)}`, "error");
        renderer.finishExportProgress(result, "error");
      }
    } finally {
      state.latestExportResult = result;
      state.isExporting = false;
      state.stopRequested = false;
      state.exportAbortController = null;
      elements.scanButton.disabled = false;
      renderer.setCounter(elements.successCount, result.success);
      renderer.setCounter(elements.failureCount, result.failure);
      renderer.updateExportAvailability();
    }
  }

  function buildRetryPlan(failedSelectionKeys) {
    const sourcePlan = state.exportPlan;
    if (!sourcePlan) {
      throw new Error("Cannot build a retry plan before scanning grouped tabs.");
    }

    const retryPlan = {
      ...sourcePlan,
      groups: sourcePlan.groups.map((group) => ({
        ...group,
        files: group.files.map((file) => ({
          ...file,
          selected: failedSelectionKeys.has(file.selectionKey)
        }))
      })),
      skippedTabs: [...sourcePlan.skippedTabs]
    };

    ExportHelpers.applyModeAndPaths(retryPlan, getPathOptions());
    return retryPlan;
  }

  function hasRetryableFailedTabs() {
    return getRetryableFailedSelectionKeys().size > 0;
  }

  function getRetryableFailedSelectionKeys() {
    const failedSelectionKeys = getLatestFailedPageSelectionKeys();
    if (!state.exportPlan || state.exportPlan.mode === CSV_MODE || failedSelectionKeys.size === 0) {
      return new Set();
    }

    const currentSelectionKeys = new Set();
    for (const group of state.exportPlan.groups) {
      for (const file of group.files) {
        currentSelectionKeys.add(file.selectionKey);
      }
    }

    return new Set(Array.from(failedSelectionKeys).filter((selectionKey) => {
      return currentSelectionKeys.has(selectionKey);
    }));
  }

  function getLatestFailedPageSelectionKeys() {
    const failedSelectionKeys = new Set();
    const pageResults = state.latestExportResult && Array.isArray(state.latestExportResult.pageResults)
      ? state.latestExportResult.pageResults
      : [];

    for (const pageResult of pageResults) {
      if (pageResult && pageResult.status === "failed" && pageResult.selectionKey) {
        failedSelectionKeys.add(pageResult.selectionKey);
      }
    }

    return failedSelectionKeys;
  }

  /**
   * Recalculate filenames/paths after any mode, destination, report, filename, or
   * selection change, then redraw the preview from the same plan object.
   */
  function refreshPlanDisplay() {
    if (!state.exportPlan) {
      renderer.updateExportAvailability();
      return;
    }

    applyModeAndPaths(state.exportPlan);
    renderer.renderPreview();
    renderer.updateExportAvailability();
  }

  /** Apply current UI options to the plan and synchronize summary counters. */
  function applyModeAndPaths(plan) {
    ExportHelpers.applyModeAndPaths(plan, getPathOptions());
    renderer.updateScanCounters(plan);
  }

  /** Gather the current UI options in the shape expected by export helpers. */
  function getPathOptions() {
    return {
      mode: getSelectedMode(),
      filenameMode: elements.filenameMode.value,
      preserveOriginalNumbers: elements.preserveOriginalNumbers.checked,
      rootFolderName: ROOT_FOLDER_NAME,
      createRootFolder: elements.createRootFolder.checked,
      downloadsFallback: isDownloadsFallbackSelected(),
      noGroupId: NO_GROUP_ID
    };
  }

  function buildPlannedRelativePath(groupFolderName, fileName) {
    return ExportHelpers.buildPlannedRelativePath(groupFolderName, fileName, getPathOptions());
  }

  function getSelectedMode() {
    const selectedInput = elements.modeInputs.find((input) => input.checked);
    return selectedInput ? selectedInput.value : HTML_RELEVANT_ASSETS_MODE;
  }

  function isDownloadsFallbackSelected() {
    return !elements.fallbackPanel.classList.contains("hidden") && elements.useDownloadsFallback.checked;
  }

  function shouldExportCsvReport() {
    return Boolean(elements.exportReportCsv && elements.exportReportCsv.checked);
  }

  function getCsvSelectedRowCount(plan) {
    return ExportHelpers.getSelectedCsvRowCount(plan);
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
})(globalThis);
