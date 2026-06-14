// @ts-check
"use strict";

/**
 * File-system and Downloads export writers for planned TabPack exports.
 * @param {typeof globalThis} root
 */
(function exposeExportWriter(root) {
  /**
   * Build the writer module.
   *
   * Writer functions assume the plan has already been refreshed with current UI
   * options. They update the shared result object so progress UI, CSV reports,
   * and final logs all describe the same export attempt.
   *
   * @param {TabPackExportContext} context
   */
  function createExportWriter(context) {
    const { state, elements, ExportHelpers } = context;
    const { ROOT_FOLDER_NAME, CSV_MODE, MHTML_MODE, CSV_FILE_NAME } = context.constants;
    const { download, permissionsContains, permissionsRequest } = context.browserApi;
    const getErrorMessage = context.getErrorMessage;
    const throwIfExportStopped = context.throwIfExportStopped;
    const isExportStopError = context.isExportStopError;
    const buildPlannedRelativePath = context.buildPlannedRelativePath;
    const shouldExportCsvReport = context.shouldExportCsvReport;
    const getCsvSelectedRowCount = context.getCsvSelectedRowCount;

    /** @param {string} message @param {TabPackLogLevel=} level */
    function logMessage(message, level = "info") {
      context.renderer.logMessage(message, level);
    }

    /** @param {HTMLElement} element @param {number} value */
    function setCounter(element, value) {
      context.renderer.setCounter(element, value);
    }

    /** @param {TabPackExportResult} result @param {number=} count */
    function markExportItemsComplete(result, count = 1) {
      context.renderer.markExportItemsComplete(result, count);
    }

    function isHtmlSnapshotMode(mode) {
      return context.htmlCapture.isHtmlSnapshotMode(mode);
    }

    function isHtmlAssetMode(mode) {
      return context.htmlCapture.isHtmlAssetMode(mode);
    }

    function getHtmlModeLogLabel(mode) {
      return context.htmlCapture.getHtmlModeLogLabel(mode);
    }

    function createCompleteHtmlPackage(group, file, assetFolderName, mode) {
      return context.htmlCapture.createCompleteHtmlPackage(group, file, assetFolderName, mode);
    }

    function logAssetWarnings(fetchFailures, writeFailures, assetFolderLabel) {
      context.htmlCapture.logAssetWarnings(fetchFailures, writeFailures, assetFolderLabel);
    }

    function saveTabAsMhtml(tabId) {
      return context.htmlCapture.saveTabAsMhtml(tabId);
    }

    /**
     * Request optional permissions only for the export path the user started.
     *
     * Keeping these permissions optional lowers install-time warnings while still
     * allowing the export click to explain why the selected mode needs extra API
     * access. `scripting` intentionally remains a required permission.
     *
     * @param {TabPackExportPlan} plan
     * @param {{ downloadsFallback?: boolean }} options
     */
    async function ensureOptionalPermissionsForExport(plan, options = {}) {
      if (plan.totalSelectedTabs === 0) {
        return;
      }

      /** @type {chrome.runtime.ManifestPermission[]} */
      const permissions = [];
      /** @type {string[]} */
      const origins = [];
      /** @type {string[]} */
      const reasons = [];

      if (ExportHelpers.modeRequiresHostAccess(plan.mode) && !state.optionalHostPermissionsGranted) {
        origins.push(...ExportHelpers.getOptionalHostOrigins());
        reasons.push("page access so TabPack can serialize selected HTTP/HTTPS tabs and fetch referenced assets");
      }

      if (plan.mode === MHTML_MODE) {
        permissions.push("pageCapture");
        reasons.push("MHTML capture so selected tabs can be saved as .mhtml files");
      }

      if (options.downloadsFallback) {
        permissions.push("downloads");
        reasons.push("Downloads fallback so files can be queued under Downloads/TabPack/");
      }

      if (permissions.length === 0 && origins.length === 0) {
        return;
      }

      /** @type {chrome.permissions.Permissions} */
      const request = {};
      if (permissions.length > 0) {
        request.permissions = permissions;
      }
      if (origins.length > 0) {
        request.origins = origins;
      }

      if (await permissionsContains(request)) {
        if (origins.length > 0) {
          state.optionalHostPermissionsGranted = true;
        }
        return;
      }

      logMessage(`This export needs permission for ${formatPermissionReasons(reasons)}.`, "warning");
      const granted = await permissionsRequest(request);
      if (!granted) {
        const alreadyGranted = await permissionsContains(request);
        if (alreadyGranted) {
          if (origins.length > 0) {
            state.optionalHostPermissionsGranted = true;
          }
          return;
        }

        throw new Error("Export was canceled because the required optional permission was not granted.");
      }

      if (origins.length > 0) {
        state.optionalHostPermissionsGranted = true;
      }
      logMessage("Optional export permission granted.", "success");
    }

    function formatPermissionReasons(reasons) {
      if (reasons.length <= 1) {
        return reasons[0] || "this export";
      }

      return `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}`;
    }

    /**
     * Write export output directly into the selected directory tree.
     *
     * This path is preferred because HTML files and their `_files` folders can be
     * conflict-resolved as a pair before anything is written.
     */
    async function exportWithFileSystemAccess(plan, result) {
      throwIfExportStopped();
      const exportRootHandle = await getExportRootDirectory(state.selectedDirectoryHandle);

      if (plan.mode === CSV_MODE) {
        await exportCsvIndexWithFileSystem(exportRootHandle, plan, result);
        return;
      }

      for (const group of plan.groups) {
        throwIfExportStopped();
        if (group.selectedCount === 0) {
          continue;
        }

        /*
         * Treat a failed group folder as failed files for that group, then keep
         * processing later groups. One blocked folder should not discard an
         * otherwise valid export plan.
         */
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
          for (const file of group.files) {
            if (file.selected) {
              recordPageResult(result, group, file, {
                status: "failed",
                error: message
              });
            }
          }
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

      if (shouldExportCsvReport()) {
        await exportCsvIndexWithFileSystem(exportRootHandle, plan, result);
      }
    }

    /** Save one non-HTML page artifact, currently MHTML, to the selected folder. */
    async function exportSingleFileWithFileSystem(groupDirectoryHandle, group, file, mode, result) {
      try {
        throwIfExportStopped();
        const blob = await createSingleFileBlob(mode, group, file);
        throwIfExportStopped();
        const finalFileName = await resolveFileName(groupDirectoryHandle, file.fileName);
        await writeBlobToDirectory(groupDirectoryHandle, finalFileName, blob);
        const finalRelativePath = buildPlannedRelativePath(group.sanitizedFolderName, finalFileName);

        result.success += 1;
        recordPageResult(result, group, file, {
          status: "saved",
          finalRelativePath
        });
        setCounter(elements.successCount, result.success);
        markExportItemsComplete(result);
        logMessage(`Saved ${group.sanitizedFolderName}/${finalFileName}.`, "success");
      } catch (error) {
        if (isExportStopError(error)) {
          throw error;
        }

        result.failure += 1;
        recordPageResult(result, group, file, {
          status: "failed",
          error: getErrorMessage(error)
        });
        setCounter(elements.failureCount, result.failure);
        markExportItemsComplete(result);
        logMessage(`Failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
      }
    }

    /** Write the selected-page CSV index at the export root. */
    async function exportCsvIndexWithFileSystem(exportRootHandle, plan, result) {
      try {
        throwIfExportStopped();
        const csvBlob = createCsvBlob(plan, result);
        throwIfExportStopped();
        const finalFileName = await resolveFileName(exportRootHandle, CSV_FILE_NAME);
        await writeBlobToDirectory(exportRootHandle, finalFileName, csvBlob);

        result.success += 1;
        setCounter(elements.successCount, result.success);
        markExportItemsComplete(result);
        logMessage(`Saved ${finalFileName} with ${getCsvSelectedRowCount(plan)} selected page row(s).`, "success");
      } catch (error) {
        if (isExportStopError(error)) {
          throw error;
        }

        result.failure += 1;
        setCounter(elements.failureCount, result.failure);
        markExportItemsComplete(result);
        logMessage(`Failed selected-page CSV index: ${getErrorMessage(error)}`, "error");
      }
    }

    /**
     * Capture and write one HTML snapshot.
     *
     * Asset-folder modes reserve the final HTML filename and asset folder name
     * together before capture so rewritten local references match the final
     * directory layout.
     */
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
          const finalRelativePath = buildPlannedRelativePath(group.sanitizedFolderName, finalFileName);

          result.success += 1;
          recordPageResult(result, group, file, {
            status: "saved",
            finalRelativePath,
            assetWarnings: htmlPackage.failures.length
          });
          result.assetWarnings += htmlPackage.failures.length;
          setCounter(elements.successCount, result.success);
          markExportItemsComplete(result);
          logMessage(`Saved ${group.sanitizedFolderName}/${finalFileName}.`, "success");
          logAssetWarnings(htmlPackage.failures, [], group.sanitizedFolderName);
          return;
        }

        const outputNames = await resolveCompleteOutputNames(groupDirectoryHandle, file);
        logMessage(`Capturing ${modeLabel} for ${group.sanitizedFolderName}/${outputNames.fileName}.`, "progress");
        const htmlPackage = await createCompleteHtmlPackage(group, file, outputNames.assetFolderName, mode);
        throwIfExportStopped();
        const writeFailures = await writeCompleteHtmlPackage(groupDirectoryHandle, outputNames, htmlPackage);
        const warningCount = htmlPackage.failures.length + writeFailures.length;
        const finalRelativePath = buildPlannedRelativePath(group.sanitizedFolderName, outputNames.fileName);
        const finalAssetFolderPath = buildPlannedRelativePath(group.sanitizedFolderName, `${outputNames.assetFolderName}/`);

        result.success += 1;
        result.assetWarnings += warningCount;
        recordPageResult(result, group, file, {
          status: "saved",
          finalRelativePath,
          finalAssetFolderPath,
          assetWarnings: warningCount
        });
        setCounter(elements.successCount, result.success);
        markExportItemsComplete(result);
        logMessage(`Saved ${group.sanitizedFolderName}/${outputNames.fileName} and ${group.sanitizedFolderName}/${outputNames.assetFolderName}/.`, "success");
        logAssetWarnings(htmlPackage.failures, writeFailures, `${group.sanitizedFolderName}/${outputNames.assetFolderName}`);
      } catch (error) {
        if (isExportStopError(error)) {
          throw error;
        }

        result.failure += 1;
        recordPageResult(result, group, file, {
          status: "failed",
          error: getErrorMessage(error)
        });
        setCounter(elements.failureCount, result.failure);
        markExportItemsComplete(result);
        logMessage(`Failed ${modeLabel} export for ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
      }
    }

    /** Return either the selected folder or the configured `TabPack/` child. */
    async function getExportRootDirectory(selectedDirectoryHandle) {
      if (!elements.createRootFolder.checked) {
        return selectedDirectoryHandle;
      }

      return selectedDirectoryHandle.getDirectoryHandle(ROOT_FOLDER_NAME, {
        create: true
      });
    }

    /**
     * Resolve a single file conflict according to the selected conflict mode.
     * `overwrite` removes either a file or folder with the requested name; the
     * default mode keeps existing files by suffixing the new name.
     */
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

    /**
     * Resolve the HTML file name and asset folder name as a coupled pair.
     *
     * This prevents `1.html` from being uniquified independently of `1_files/`,
     * which would otherwise produce broken local asset references.
     */
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

    /**
     * Check for either a file or directory with the same name.
     *
     * File System Access throws `TypeMismatchError` when the name exists as the
     * other entry kind; for conflict detection that still means "occupied".
     */
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

    /** Remove an existing file or directory for overwrite mode. */
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

    /**
     * Write assets first and the HTML file last.
     *
     * The HTML is the user-visible artifact, so writing it last reduces the
     * chance of leaving an apparently complete page that points to assets we
     * never attempted to persist.
     */
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

    /** Write a Blob through File System Access and abort the stream on failure. */
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

    /**
     * Queue files through `chrome.downloads`.
     *
     * Downloads fallback cannot atomically coordinate HTML/assets conflicts, so
     * it records requested paths instead of final filesystem paths.
     */
    async function exportWithDownloadsFallback(plan, result) {
      throwIfExportStopped();
      if (plan.mode === CSV_MODE) {
        await exportCsvIndexWithDownloadsFallback(plan, result);
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

      if (shouldExportCsvReport()) {
        await exportCsvIndexWithDownloadsFallback(plan, result);
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
        recordPageResult(result, group, file, {
          status: "queued",
          requestedRelativePath: filename,
          finalRelativePath: filename
        });
        setCounter(elements.successCount, result.success);
        markExportItemsComplete(result);
        logMessage(`Queued fallback download ${filename}.`, "success");
      } catch (error) {
        if (isExportStopError(error)) {
          throw error;
        }

        result.failure += 1;
        recordPageResult(result, group, file, {
          status: "failed",
          requestedRelativePath: `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`,
          error: getErrorMessage(error)
        });
        setCounter(elements.failureCount, result.failure);
        markExportItemsComplete(result);
        logMessage(`Fallback failed ${group.sanitizedFolderName}/${file.fileName}: ${getErrorMessage(error)}`, "error");
      }
    }

    async function exportCsvIndexWithDownloadsFallback(plan, result) {
      try {
        throwIfExportStopped();
        const csvBlob = createCsvBlob(plan, result);
        throwIfExportStopped();
        const filename = `${ROOT_FOLDER_NAME}/${CSV_FILE_NAME}`;
        await downloadBlob(csvBlob, filename);

        result.success += 1;
        setCounter(elements.successCount, result.success);
        markExportItemsComplete(result);
        logMessage(`Queued fallback download ${filename} with ${getCsvSelectedRowCount(plan)} selected page row(s).`, "success");
      } catch (error) {
        if (isExportStopError(error)) {
          throw error;
        }

        result.failure += 1;
        setCounter(elements.failureCount, result.failure);
        markExportItemsComplete(result);
        logMessage(`Fallback selected-page CSV index failed: ${getErrorMessage(error)}`, "error");
      }
    }

    /**
     * Queue an HTML snapshot through Downloads fallback.
     *
     * Asset downloads are queued one-by-one because the downloads API has no
     * directory handle. Failed asset downloads become warnings; the HTML download
     * can still be useful.
     */
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
        recordPageResult(result, group, file, {
          status: "queued",
          requestedRelativePath: htmlFilename,
          finalRelativePath: htmlFilename,
          finalAssetFolderPath: usesAssetFolder
            ? `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.assetFolderName}/`
            : "",
          assetWarnings: htmlPackage.failures.length
        });
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
        recordPageResult(result, group, file, {
          status: "failed",
          requestedRelativePath: `${ROOT_FOLDER_NAME}/${group.sanitizedFolderName}/${file.fileName}`,
          error: getErrorMessage(error)
        });
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

    /** Convert the generated CSV string to a browser-downloadable Blob. */
    function createCsvBlob(plan, result) {
      return new Blob([generateCsvIndex(plan, result)], {
        type: "text/csv;charset=utf-8"
      });
    }

    function generateCsvIndex(plan, result) {
      return ExportHelpers.generateCsvIndex(plan, {
        exportedAt: result && result.exportedAt,
        pageResults: result && result.pageResults
      });
    }

    /**
     * Record per-page output details for report CSV generation.
     *
     * Selected-folder export can report final uniquified paths; Downloads fallback
     * reports requested paths because the browser owns final conflict resolution.
     */
    function recordPageResult(result, group, file, details = {}) {
      result.pageResults.push({
        selectionKey: file.selectionKey,
        groupId: group.groupId,
        tabId: file.tabId,
        status: details.status || "",
        plannedRelativePath: file.plannedRelativePath,
        plannedAssetFolderPath: file.plannedAssetFolderPath || file.plannedReferenceAssetFolderPath,
        requestedRelativePath: details.requestedRelativePath || "",
        finalRelativePath: details.finalRelativePath || "",
        finalAssetFolderPath: details.finalAssetFolderPath || "",
        assetWarnings: details.assetWarnings || 0,
        error: details.error || ""
      });
    }

    /** Count progress units before export starts so the progress bar is stable. */
    function getExportProgressItemCount(plan) {
      const reportFileCount = shouldExportCsvReport() ? 1 : 0;
      const pageCount = plan.mode === CSV_MODE ? 0 : plan.totalSelectedTabs;
      return pageCount + reportFileCount;
    }

    return Object.freeze({
      ensureOptionalPermissionsForExport,
      exportWithFileSystemAccess,
      exportWithDownloadsFallback,
      getExportProgressItemCount
    });
  }

  root.TabPackExportWriter = Object.freeze({
    create: createExportWriter
  });
})(globalThis);
