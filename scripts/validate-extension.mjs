import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(repoRoot, "extension");

const expectedFiles = [
  "manifest.json",
  "background/service-worker.js",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "export/export.html",
  "export/export.css",
  "export/export.js",
  "export/page-serializer.js",
  "shared/constants.js",
  "shared/browser-api.js",
  "shared/export-helpers.js",
  "assets/icons/icon16.png",
  "assets/icons/icon32.png",
  "assets/icons/icon48.png",
  "assets/icons/icon128.png"
];

const rootRuntimeFiles = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "archive.html",
  "archive.js",
  "export.html",
  "export.js",
  "page-serializer.js"
];

export function validateExtension() {
  const errors = [];

  for (const relativePath of expectedFiles) {
    assertFile(relativePath, errors);
  }

  for (const relativePath of rootRuntimeFiles) {
    if (existsSync(path.join(repoRoot, relativePath))) {
      errors.push(`Runtime file should not remain at repo root: ${relativePath}`);
    }
  }

  const manifest = readJson("manifest.json", errors);
  if (manifest) {
    validateManifest(manifest, errors);
  }

  validateHtmlReferences("popup/popup.html", errors);
  validateHtmlReferences("export/export.html", errors);
  validatePngSignature("assets/icons/icon16.png", errors);
  validatePngSignature("assets/icons/icon32.png", errors);
  validatePngSignature("assets/icons/icon48.png", errors);
  validatePngSignature("assets/icons/icon128.png", errors);

  if (!existsSync(path.join(repoRoot, "dist", "README.md"))) {
    errors.push("dist/README.md is missing.");
  }

  if (errors.length) {
    const message = errors.map((error) => `- ${error}`).join("\n");
    throw new Error(`Extension validation failed:\n${message}`);
  }
}

function assertFile(relativePath, errors) {
  const absolutePath = path.join(extensionDir, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`Missing expected file: extension/${relativePath}`);
    return;
  }

  if (!statSync(absolutePath).isFile()) {
    errors.push(`Expected a file: extension/${relativePath}`);
  }
}

function readJson(relativePath, errors) {
  try {
    return JSON.parse(readFileSync(path.join(extensionDir, relativePath), "utf8"));
  } catch (error) {
    errors.push(`Could not parse extension/${relativePath}: ${error.message}`);
    return null;
  }
}

function validateManifest(manifest, errors) {
  if (manifest.manifest_version !== 3) {
    errors.push("manifest.json must use manifest_version 3.");
  }

  validateManifestFile(manifest.background?.service_worker, "background.service_worker", errors);
  validateManifestFile(manifest.action?.default_popup, "action.default_popup", errors);

  for (const [size, relativePath] of Object.entries(manifest.icons || {})) {
    validateManifestFile(relativePath, `icons.${size}`, errors);
  }

  for (const [size, relativePath] of Object.entries(manifest.action?.default_icon || {})) {
    validateManifestFile(relativePath, `action.default_icon.${size}`, errors);
  }

  for (const permission of ["tabs", "tabGroups", "pageCapture", "downloads", "scripting", "storage"]) {
    if (!manifest.permissions?.includes(permission)) {
      errors.push(`manifest.json is missing required permission: ${permission}`);
    }
  }

  for (const hostPermission of ["http://*/*", "https://*/*"]) {
    if (manifest.host_permissions?.includes(hostPermission)) {
      errors.push(`manifest.json should not request broad install-time host permission: ${hostPermission}`);
    }

    if (!manifest.optional_host_permissions?.includes(hostPermission)) {
      errors.push(`manifest.json is missing optional host permission: ${hostPermission}`);
    }
  }
}

function validateManifestFile(relativePath, label, errors) {
  if (!relativePath || typeof relativePath !== "string") {
    errors.push(`manifest.json is missing ${label}.`);
    return;
  }

  if (!existsSync(path.join(extensionDir, relativePath))) {
    errors.push(`manifest.json ${label} points to missing file: ${relativePath}`);
  }
}

function validateHtmlReferences(relativePath, errors) {
  const htmlPath = path.join(extensionDir, relativePath);
  const html = readFileSync(htmlPath, "utf8");
  const directory = path.dirname(htmlPath);

  if (/<style[\s>]/i.test(html)) {
    errors.push(`Inline <style> block remains in extension/${relativePath}.`);
  }

  const referencePattern = /<(script|link)\b[^>]*(?:src|href)="([^"]+)"/gi;
  let match = referencePattern.exec(html);
  while (match) {
    const reference = match[2];
    if (!isExternalReference(reference)) {
      const targetPath = path.resolve(directory, reference);
      if (!targetPath.startsWith(extensionDir) || !existsSync(targetPath)) {
        errors.push(`extension/${relativePath} points to missing asset: ${reference}`);
      }
    }

    match = referencePattern.exec(html);
  }
}

function isExternalReference(reference) {
  return /^(?:[a-z]+:)?\/\//i.test(reference) ||
    reference.startsWith("data:") ||
    reference.startsWith("#");
}

function validatePngSignature(relativePath, errors) {
  const absolutePath = path.join(extensionDir, relativePath);
  const signature = readFileSync(absolutePath).subarray(0, 8);
  if (signature.toString("hex") !== "89504e470d0a1a0a") {
    errors.push(`Icon is not a PNG file: extension/${relativePath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    validateExtension();
    console.log("Extension validation passed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
