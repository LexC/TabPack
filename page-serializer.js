"use strict";

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
