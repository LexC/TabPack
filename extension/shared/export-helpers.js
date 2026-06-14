"use strict";

(function exposeExportHelpers(root) {
  const constants = root.TabPackConstants || {};
  const ROOT_FOLDER_NAME = constants.ROOT_FOLDER_NAME || "TabPack";
  const MAX_FOLDER_NAME_LENGTH = constants.MAX_FOLDER_NAME_LENGTH || 80;
  const HTML_PAGE_MODE = constants.HTML_PAGE_MODE || "html";
  const HTML_LOCAL_ASSET_PATHS_MODE = constants.HTML_LOCAL_ASSET_PATHS_MODE || "html-local";
  const HTML_RELEVANT_ASSETS_MODE = constants.HTML_RELEVANT_ASSETS_MODE || "html-relevant";
  const HTML_ALL_ASSETS_MODE = constants.HTML_ALL_ASSETS_MODE || "html-all";
  const CSV_MODE = constants.CSV_MODE || "csv";
  const MHTML_MODE = constants.MHTML_MODE || "mhtml";
  const CSV_FILE_NAME = constants.CSV_FILE_NAME || "tab-groups.csv";
  const OPTIONAL_HOST_ORIGINS = ["http://*/*", "https://*/*"];

  function collectTabGroupIds(tabs, options = {}) {
    const noGroupId = typeof options.noGroupId === "number" ? options.noGroupId : -1;
    const groupIds = new Set();

    for (const tab of tabs || []) {
      if (typeof tab.groupId === "number" && tab.groupId !== noGroupId) {
        groupIds.add(tab.groupId);
      }
    }

    return Array.from(groupIds);
  }

  function buildExportPlanFromTabs(tabs, groupMetadata, options = {}) {
    const skippedTabs = [];
    const eligibleTabs = [];
    const noGroupId = typeof options.noGroupId === "number" ? options.noGroupId : -1;
    const selectedKeys = options.selectedKeys ? new Set(options.selectedKeys) : null;
    const sortedTabs = [...(tabs || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    for (const tab of sortedTabs) {
      const metadata = getGroupMetadata(groupMetadata, tab.groupId);

      if (typeof tab.id !== "number") {
        skippedTabs.push(makeSkippedTab(tab, "missing tab ID", metadata));
        continue;
      }

      if (tab.groupId === noGroupId || typeof tab.groupId !== "number") {
        skippedTabs.push(makeSkippedTab(tab, "ungrouped", metadata));
        continue;
      }

      if (!isSupportedTabUrl(tab.url)) {
        skippedTabs.push(makeSkippedTab(tab, "unsupported URL", metadata));
        continue;
      }

      eligibleTabs.push(tab);
    }

    const groupsById = new Map();

    for (const tab of eligibleTabs) {
      const metadata = getGroupMetadata(groupMetadata, tab.groupId);
      if (!metadata) {
        skippedTabs.push(makeSkippedTab(tab, "missing group metadata", metadata));
        continue;
      }

      if (!groupsById.has(tab.groupId)) {
        const originalTitle = metadata.title || `Group_${tab.groupId}`;
        groupsById.set(tab.groupId, {
          groupId: tab.groupId,
          originalTitle,
          sanitizedFolderName: "",
          firstTabIndex: tab.index ?? 0,
          selectedCount: 0,
          files: []
        });
      }

      const selectionKey = makeSelectionKey(tab.groupId, tab.id);
      groupsById.get(tab.groupId).files.push({
        selectionKey,
        selected: selectedKeys ? selectedKeys.has(selectionKey) : true,
        tabId: tab.id,
        tabIndex: tab.index ?? 0,
        order: 0,
        selectedOrderInGroup: "",
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

    annotateSkippedGroupFolders(skippedTabs, groupsById, groupMetadata);

    const plan = {
      mode: options.mode || HTML_RELEVANT_ASSETS_MODE,
      generatedAt: options.generatedAt || new Date().toISOString(),
      groups,
      skippedTabs,
      totalEligibleTabs: groups.reduce((total, group) => total + group.files.length, 0),
      totalSelectedTabs: 0,
      totalDeselectedTabs: 0,
      csvFileName: CSV_FILE_NAME,
      csvRelativePath: ""
    };

    applyModeAndPaths(plan, options);
    return plan;
  }

  function annotateSkippedGroupFolders(skippedTabs, groupsById, groupMetadata) {
    for (const skippedTab of skippedTabs) {
      if (typeof skippedTab.groupId !== "number") {
        continue;
      }

      const eligibleGroup = groupsById.get(skippedTab.groupId);
      if (eligibleGroup) {
        skippedTab.groupName = eligibleGroup.originalTitle;
        skippedTab.groupFolder = eligibleGroup.sanitizedFolderName;
        continue;
      }

      const metadata = getGroupMetadata(groupMetadata, skippedTab.groupId);
      if (metadata) {
        skippedTab.groupName = metadata.title || `Group_${skippedTab.groupId}`;
        skippedTab.groupFolder = sanitizeFolderName(skippedTab.groupName, skippedTab.groupId);
      }
    }
  }

  function getGroupMetadata(groupMetadata, groupId) {
    if (typeof groupId !== "number" || !groupMetadata) {
      return null;
    }

    if (typeof groupMetadata.get === "function") {
      return groupMetadata.get(groupId) || groupMetadata.get(String(groupId)) || null;
    }

    return groupMetadata[groupId] || groupMetadata[String(groupId)] || null;
  }

  function makeSelectionKey(groupId, tabId) {
    return `${groupId}:${tabId}`;
  }

  function applyModeAndPaths(plan, options = {}) {
    const mode = options.mode || plan.mode || HTML_RELEVANT_ASSETS_MODE;
    const rootFolderName = options.rootFolderName || ROOT_FOLDER_NAME;
    const createRootFolder = options.createRootFolder !== false;
    const downloadsFallback = Boolean(options.downloadsFallback);
    const extension = mode === MHTML_MODE ? "mhtml" : "html";

    plan.mode = mode;
    plan.csvFileName = CSV_FILE_NAME;
    plan.csvRelativePath = mode === CSV_MODE
      ? buildRootRelativePath(CSV_FILE_NAME, { rootFolderName, createRootFolder, downloadsFallback })
      : "";

    let selectedTotal = 0;
    let eligibleTotal = 0;

    for (const group of plan.groups || []) {
      let selectedOrder = 0;
      eligibleTotal += group.files.length;

      for (const file of group.files) {
        const isSelected = file.selected !== false;
        file.selected = isSelected;
        file.outputExtension = mode === CSV_MODE || !isSelected ? "" : extension;

        if (isSelected) {
          selectedOrder += 1;
          file.selectedOrderInGroup = selectedOrder;
          file.baseFileName = String(selectedOrder);
          file.fileName = mode === CSV_MODE ? "" : `${file.baseFileName}.${extension}`;
          file.referenceAssetFolderName = mode !== CSV_MODE && (isHtmlLocalReferenceMode(mode) || isHtmlAssetMode(mode))
            ? `${file.baseFileName}_files`
            : "";
          file.assetFolderName = mode !== CSV_MODE && isHtmlAssetMode(mode)
            ? file.referenceAssetFolderName
            : "";
          file.plannedRelativePath = file.fileName
            ? buildPlannedRelativePath(group.sanitizedFolderName, file.fileName, { rootFolderName, createRootFolder, downloadsFallback })
            : "";
          file.plannedReferenceAssetFolderPath = isHtmlLocalReferenceMode(mode)
            ? buildPlannedRelativePath(group.sanitizedFolderName, `${file.referenceAssetFolderName}/`, { rootFolderName, createRootFolder, downloadsFallback })
            : "";
          file.plannedAssetFolderPath = file.assetFolderName
            ? buildPlannedRelativePath(group.sanitizedFolderName, `${file.assetFolderName}/`, { rootFolderName, createRootFolder, downloadsFallback })
            : "";
        } else {
          file.selectedOrderInGroup = "";
          file.baseFileName = "";
          file.fileName = "";
          file.referenceAssetFolderName = "";
          file.assetFolderName = "";
          file.plannedRelativePath = "";
          file.plannedReferenceAssetFolderPath = "";
          file.plannedAssetFolderPath = "";
        }
      }

      group.selectedCount = selectedOrder;
      selectedTotal += selectedOrder;
    }

    plan.totalEligibleTabs = eligibleTotal;
    plan.totalSelectedTabs = selectedTotal;
    plan.totalDeselectedTabs = Math.max(0, eligibleTotal - selectedTotal);
    return plan;
  }

  function buildPlannedRelativePath(groupFolderName, fileName, options = {}) {
    const rootFolderName = options.rootFolderName || ROOT_FOLDER_NAME;
    if (options.downloadsFallback || options.createRootFolder !== false) {
      return `${rootFolderName}/${groupFolderName}/${fileName}`;
    }

    return `${groupFolderName}/${fileName}`;
  }

  function buildRootRelativePath(fileName, options = {}) {
    const rootFolderName = options.rootFolderName || ROOT_FOLDER_NAME;
    if (options.downloadsFallback || options.createRootFolder !== false) {
      return `${rootFolderName}/${fileName}`;
    }

    return fileName;
  }

  function generateCsvIndex(plan, options = {}) {
    const exportedAt = options.exportedAt || new Date().toISOString();
    const rows = [[
      "exported_at",
      "row_status",
      "selected_for_export",
      "skip_reason",
      "export_mode",
      "group_order",
      "group_id",
      "group_name",
      "group_folder",
      "tab_order_in_group",
      "selected_order_in_group",
      "tab_index",
      "tab_id",
      "page_title",
      "page_url",
      "planned_file_path",
      "planned_asset_folder_path"
    ]];

    for (const [groupIndex, group] of (plan.groups || []).entries()) {
      for (const file of group.files) {
        rows.push([
          exportedAt,
          file.selected ? "selected" : "deselected",
          file.selected ? "true" : "false",
          "",
          plan.mode,
          String(groupIndex + 1),
          String(group.groupId),
          group.originalTitle,
          group.sanitizedFolderName,
          String(file.order),
          file.selected ? String(file.selectedOrderInGroup) : "",
          String(file.tabIndex),
          String(file.tabId),
          cleanCsvPageTitle(file.title),
          file.url,
          file.plannedRelativePath,
          file.plannedAssetFolderPath
        ]);
      }
    }

    for (const skippedTab of plan.skippedTabs || []) {
      rows.push([
        exportedAt,
        "skipped",
        "false",
        skippedTab.reason || "",
        plan.mode,
        "",
        skippedTab.groupId === null || typeof skippedTab.groupId === "undefined" ? "" : String(skippedTab.groupId),
        skippedTab.groupName || "",
        skippedTab.groupFolder || "",
        "",
        "",
        skippedTab.tabIndex === null || typeof skippedTab.tabIndex === "undefined" ? "" : String(skippedTab.tabIndex),
        skippedTab.tabId === null || typeof skippedTab.tabId === "undefined" ? "" : String(skippedTab.tabId),
        cleanCsvPageTitle(skippedTab.title),
        skippedTab.url || "",
        "",
        ""
      ]);
    }

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

  function summarizeTabs(tabs, options = {}) {
    const noGroupId = typeof options.noGroupId === "number" ? options.noGroupId : -1;
    const groupIds = new Set();
    let eligibleGroupedTabs = 0;
    let unsupportedGroupedTabs = 0;
    let ungroupedTabs = 0;
    let missingTabIds = 0;

    for (const tab of tabs || []) {
      if (typeof tab.id !== "number") {
        missingTabIds += 1;
        continue;
      }

      if (tab.groupId === noGroupId || typeof tab.groupId !== "number") {
        ungroupedTabs += 1;
        continue;
      }

      groupIds.add(tab.groupId);

      if (isSupportedTabUrl(tab.url)) {
        eligibleGroupedTabs += 1;
      } else {
        unsupportedGroupedTabs += 1;
      }
    }

    return {
      groupCount: groupIds.size,
      eligibleGroupedTabs,
      unsupportedGroupedTabs,
      ungroupedTabs,
      missingTabIds,
      skippedTabs: unsupportedGroupedTabs + ungroupedTabs + missingTabIds
    };
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
    return String(folderName)
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

  function makeSkippedTab(tab, reason, metadata) {
    const groupId = typeof tab.groupId === "number" ? tab.groupId : null;
    const groupName = metadata && groupId !== null
      ? metadata.title || `Group_${groupId}`
      : "";

    return {
      reason,
      tabId: typeof tab.id === "number" ? tab.id : null,
      groupId,
      groupName,
      groupFolder: groupName ? sanitizeFolderName(groupName, groupId) : "",
      tabIndex: typeof tab.index === "number" ? tab.index : null,
      title: tab.title || "(untitled)",
      url: tab.url || "(no URL)"
    };
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

  function modeRequiresHostAccess(mode) {
    return isHtmlSnapshotMode(mode);
  }

  function getOptionalHostOrigins() {
    return [...OPTIONAL_HOST_ORIGINS];
  }

  const api = Object.freeze({
    collectTabGroupIds,
    buildExportPlanFromTabs,
    applyModeAndPaths,
    buildPlannedRelativePath,
    buildRootRelativePath,
    generateCsvIndex,
    formatCsvCell,
    cleanCsvPageTitle,
    summarizeTabs,
    assignUniqueFolderNames,
    sanitizeFolderName,
    isSupportedTabUrl,
    makeSelectionKey,
    isHtmlSnapshotMode,
    isHtmlLocalReferenceMode,
    isHtmlAssetMode,
    modeRequiresHostAccess,
    getOptionalHostOrigins
  });

  root.TabPackExportHelpers = api;

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(globalThis);
