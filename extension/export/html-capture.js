// @ts-check
"use strict";

/**
 * HTML snapshot capture and asset localization for export modes.
 * @param {typeof globalThis} root
 */
(function exposeTabPackHtmlCapture(root) {
  /**
   * Build the HTML capture module.
   *
   * This module bridges two worlds: injected page serialization and extension-page
   * asset fetching. Keeping that split here prevents export writers from needing
   * to know how HTML, CSS, and nested assets are discovered.
   *
   * @param {TabPackExportContext} context
   */
  function createHtmlCapture(context) {
    const { state } = context;
    const {
      MAX_ASSET_FILE_NAME_LENGTH,
      HTML_PAGE_MODE,
      HTML_LOCAL_ASSET_PATHS_MODE,
      HTML_RELEVANT_ASSETS_MODE,
      HTML_ALL_ASSETS_MODE,
      HTML_ASSET_NONE,
      HTML_ASSET_RELEVANT,
      HTML_ASSET_ALL,
      RUN_SERIALIZER_IN_TAB_MESSAGE
    } = context.constants;
    const {
      executeScript,
      executeLegacyTabScript,
      sendRuntimeMessage,
      saveAsMHTML
    } = context.browserApi;
    const getErrorMessage = context.getErrorMessage;
    const throwIfExportStopped = context.throwIfExportStopped;
    const isExportStopError = context.isExportStopError;

    /** @param {string} message @param {TabPackLogLevel=} level */
    function logMessage(message, level = "info") {
      context.renderer.logMessage(message, level);
    }

    function splitFileName(fileName) {
      const dotIndex = fileName.lastIndexOf(".");
      if (dotIndex <= 0) {
        return { baseName: fileName, extension: "" };
      }
      return { baseName: fileName.slice(0, dotIndex), extension: fileName.slice(dotIndex) };
    }

    function isReservedAssetFileName(fileName) {
      return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(fileName);
    }

    /**
     * Capture the page HTML, optionally fetch referenced assets, and return a
     * package ready for either File System Access writes or Downloads fallback.
     */
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

    /**
     * Run the page serializer inside the target tab and validate its return
     * shape before the rest of the export pipeline trusts it.
     */
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

    /**
     * Try serializer execution paths from most modern to most compatible.
     *
     * The export page can call `chrome.scripting` in supported Chromium builds.
     * Legacy `tabs.executeScript` and the background service-worker fallback keep
     * the same serializer available in older or restricted extension contexts.
     */
    function executeSerializerInTab(tabId, options) {
      const scriptingApi = getScriptingApi();
      if (scriptingApi && typeof scriptingApi.api.executeScript === "function") {
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

    /** Detect callback-style Chrome APIs and promise-style browser APIs. */
    function getScriptingApi() {
      if (typeof chrome !== "undefined" && chrome.scripting) {
        return {
          api: chrome.scripting,
          style: "callback"
        };
      }

      const promiseBrowser = root.browser;
      if (promiseBrowser && promiseBrowser.scripting) {
        return {
          api: promiseBrowser.scripting,
          style: "promise"
        };
      }

      return null;
    }

    /** Execute the self-contained serializer function through `chrome.scripting`. */
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

    /** Fallback for older Chromium APIs that accept a string of injected code. */
    function executeSerializerWithLegacyTabsApi(tabId, options) {
      const code = `(${serializeCompleteHtmlInPage.toString()})(${JSON.stringify(options)})`;
      return executeLegacyTabScript(tabId, {
        code,
        runAt: "document_idle"
      }).then((results) => {
        return Array.isArray(results) ? results[0] : null;
      });
    }

    /**
     * Ask the service worker to run the serializer when the export page cannot
     * access a suitable script execution API directly.
     */
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

    /**
     * Track asset de-duplication, reserved filenames, fetched blobs, and warnings
     * for one captured page.
     */
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

    /**
     * Fetch an asset at most once per page and reserve a stable local filename.
     *
     * The serializer may discover the same URL through multiple attributes, so
     * `assetPromisesByUrl` de-duplicates both in-flight and completed fetches.
     */
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

    /** Accept only absolute HTTP/HTTPS asset URLs for extension-page fetches. */
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

    /**
     * Prefer the serializer's chosen filename when it is still unique; otherwise
     * fall back to the same uniquification path used for discovered assets.
     */
    function reservePreferredAssetFileName(fileName, context) {
      const sanitized = trimAssetFileName(sanitizeAssetFileName(fileName)) || "asset";

      if (!context.usedFileNames.has(sanitized.toLowerCase())) {
        context.usedFileNames.add(sanitized.toLowerCase());
        return sanitized;
      }

      return uniquifyAssetFileName(sanitized, context);
    }

    /** Derive a filesystem-safe asset filename from a URL plus resource kind. */
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
      return isReservedAssetFileName(sanitized) ? `${sanitized}_asset` : sanitized;
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

    /**
     * Fetch one asset using page-like credentials.
     *
     * CSS files are special because their own `url(...)` and `@import` references
     * must either be absolutized or recursively localized depending on mode.
     */
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

    /** Localize both CSS `url(...)` and quoted `@import` references. */
    async function rewriteCssAssetUrls(cssText, cssUrl, context) {
      const withUrls = await rewriteCssUrlFunctions(cssText, cssUrl, context);
      return rewriteCssImports(withUrls, cssUrl, context);
    }

    /**
     * Keep relevant-assets mode shallow: stylesheet internals remain online URLs
     * instead of growing the asset folder recursively.
     */
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

    /**
     * Add a small provenance comment to exported HTML without changing visible
     * page content.
     */
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

    /** Report asset fetch/write warnings while keeping the main page export usable. */
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

    return Object.freeze({
      createCompleteHtmlPackage,
      logAssetWarnings,
      saveTabAsMhtml,
      isHtmlSnapshotMode,
      isHtmlLocalReferenceMode,
      isHtmlAssetMode,
      getHtmlModeLogLabel
    });
  }

  root.TabPackHtmlCapture = Object.freeze({
    create: createHtmlCapture
  });
})(globalThis);
