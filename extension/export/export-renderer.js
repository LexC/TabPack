// @ts-check
"use strict";

/**
 * Rendering, counters, progress, and logging for the export page.
 * @param {typeof globalThis} root
 */
(function exposeExportRenderer(root) {
  /**
   * Build the renderer module.
   *
   * Rendering functions are the only export-page code that should create preview
   * DOM nodes or update progress/log UI. They read the shared plan and state, but
   * leave export side effects to destination/writer modules.
   *
   * @param {TabPackExportContext} context
   */
  function createExportRenderer(context) {
    const { state, elements } = context;
    const { ROOT_FOLDER_NAME, CSV_MODE, HTML_RELEVANT_ASSETS_MODE, HTML_ALL_ASSETS_MODE } = context.constants;
    const shouldExportCsvReport = context.shouldExportCsvReport;
    const getCsvSelectedRowCount = context.getCsvSelectedRowCount;
    const isDownloadsFallbackSelected = context.isDownloadsFallbackSelected;
    const refreshPlanDisplay = context.refreshPlanDisplay;

    /**
     * Rebuild the full preview from the current plan.
     *
     * The preview is intentionally regenerated instead of patched in place so
     * selection changes, mode changes, and destination changes all flow through
     * one rendering path.
     */
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

      const reportBlock = document.createElement("div");
      reportBlock.className = "group-preview";

      const reportHeading = document.createElement("h3");
      reportHeading.textContent = "Report CSV";
      reportBlock.append(reportHeading);

      const reportFields = document.createElement("div");
      reportFields.className = "preview-fields";
      if (shouldExportCsvReport()) {
        appendPreviewField(reportFields, "CSV file", state.exportPlan.csvRelativePath, {
          path: true
        });
        appendPreviewField(reportFields, "CSV rows", `${getCsvSelectedRowCount(state.exportPlan)} selected page row(s)`);
      } else {
        appendPreviewField(reportFields, "Status", "Not exported", {
          note: true
        });
        if (state.exportPlan.mode === CSV_MODE) {
          appendPreviewField(reportFields, "CSV mode", "Enable Export report CSV before exporting", {
            note: true
          });
        }
      }
      reportBlock.append(reportFields);
      fragment.append(reportBlock);

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
            if (file.selected) {
              appendPreviewField(fields, "CSV row", shouldExportCsvReport() ? "Included" : "Not exported");
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

    /** Append a label/value pair to the compact preview field layout. */
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

    /** Calculate checkbox state for a group-level tri-state selection control. */
    function getGroupSelectionState(group) {
      const selectedCount = group.files.filter((file) => file.selected).length;
      return {
        checked: selectedCount > 0 && selectedCount === group.files.length,
        indeterminate: selectedCount > 0 && selectedCount < group.files.length
      };
    }

    /**
     * Mutate selection in the shared plan, then let the entrypoint recalculate
     * selected order and filenames through `refreshPlanDisplay()`.
     */
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

    /** Toggle a single planned file by stable group/tab selection key. */
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

    /**
     * Render skipped tabs grouped by reason so unsupported URLs, ungrouped tabs,
     * and missing metadata are visible without crowding the main preview.
     */
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

      const groups = groupSkippedTabsByReason(state.skippedTabs);
      const container = document.createElement("div");
      container.className = "skipped-groups";

      for (const group of groups) {
        const section = document.createElement("section");
        section.className = "skipped-reason-group";

        const heading = document.createElement("h3");
        heading.className = "skipped-reason-heading";

        const reason = document.createElement("span");
        reason.className = "skipped-reason";
        reason.textContent = formatSkippedReason(group.reason);

        const count = document.createElement("span");
        count.className = "skipped-reason-count";
        count.textContent = String(group.tabs.length);

        heading.append(reason, count);
        section.append(heading);

        const list = document.createElement("ul");
        list.className = "skipped-list";

        for (const skippedTab of group.tabs) {
          const item = document.createElement("li");
          item.className = "skipped-item";

          const title = document.createElement("span");
          title.className = "skipped-title";
          title.textContent = skippedTab.title || "(untitled)";

          const url = document.createElement("span");
          url.className = "skipped-url";
          url.textContent = skippedTab.url || "(no URL)";

          item.append(title, " ", url);
          list.append(item);
        }

        section.append(list);
        container.append(section);
      }

      elements.skippedTabs.append(container);
    }

    /** Group skipped-tab records while preserving the scan order within a reason. */
    function groupSkippedTabsByReason(skippedTabs) {
      const groupsByReason = new Map();

      for (const skippedTab of skippedTabs) {
        const reason = skippedTab.reason || "skipped";
        if (!groupsByReason.has(reason)) {
          groupsByReason.set(reason, []);
        }
        groupsByReason.get(reason).push(skippedTab);
      }

      return Array.from(groupsByReason, ([reason, tabs]) => ({ reason, tabs }));
    }

    function formatSkippedReason(reason) {
      if (!reason) {
        return "Skipped";
      }

      return reason
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(" ");
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

    /**
     * Centralize export-button enablement.
     *
     * The button requires a plan, selected output, a usable destination, and CSV
     * report opt-in when CSV mode is the actual output.
     */
    function updateExportAvailability() {
      const hasPlan = Boolean(state.exportPlan && state.exportPlan.totalEligibleTabs > 0);
      const hasSelection = Boolean(state.exportPlan && state.exportPlan.totalSelectedTabs > 0);
      const hasModeOutput = Boolean(state.exportPlan && (
        state.exportPlan.mode !== CSV_MODE || shouldExportCsvReport()
      ));
      const hasSelectedFolder = Boolean(state.selectedDirectoryHandle && state.selectedDirectoryWritable);
      const hasDestination = hasSelectedFolder || isDownloadsFallbackSelected();
      elements.exportButton.disabled = state.isExporting || !hasPlan || !hasSelection || !hasModeOutput || !hasDestination;
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

    /** Reset progress UI to its non-exporting state. */
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

    /**
     * Initialize progress with a known total so subsequent updates never resize
     * the progress model while an export is running.
     */
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

    /** Advance completed progress units after each page/report outcome. */
    function markExportItemsComplete(result, count = 1) {
      if (!result || !Number.isFinite(result.totalItems)) {
        return;
      }

      result.completedItems = Math.min(result.totalItems, result.completedItems + count);
      updateExportProgress(result, "Export is running.");
    }

    /** Apply final visual state after done, warning, stopped, or error outcome. */
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

    /**
     * Append one timestamped log row.
     *
     * Logs are plain text on purpose: export messages can contain page titles and
     * paths, so using `textContent` avoids accidental markup interpretation.
     */
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

    return Object.freeze({
      renderPreview,
      renderSkippedTabs,
      clearPreview,
      clearSkippedTabs,
      updateExportAvailability,
      updateScanCounters,
      resetCounters,
      setCounter,
      setExportProgressIdle,
      resetExportProgress,
      markExportItemsComplete,
      finishExportProgress,
      logMessage
    });
  }

  root.TabPackExportRenderer = Object.freeze({
    create: createExportRenderer
  });
})(globalThis);
