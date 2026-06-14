// @ts-check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionDir = path.join(repoRoot, "extension");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
const gitignorePath = path.join(repoRoot, ".gitignore");

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

const requiredPackageScripts = [
  "check",
  "test",
  "test:unit",
  "test:e2e",
  "validate",
  "build",
  "build:edge",
  "build:chrome"
];

const requiredCiCommands = [
  "npm run check"
];

const requiredGitignoreEntries = [
  "dist/*.zip",
  "dist/*.crx",
  "node_modules/",
  "test-results/",
  "playwright-report/"
];

const allowedZipRootEntries = new Set([
  "manifest.json",
  "background",
  "popup",
  "export",
  "shared",
  "assets"
]);

const forbiddenReleaseReferences = [
  ["tabpack", "export-report"].join("-") + ".json",
  ["EXPORT", "REPORT", "FILE", "NAME"].join("_"),
  ["generate", "Export", "Report"].join("")
];

const textFileExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".txt",
  ".yml",
  ".yaml"
]);

const scanRoots = [
  ".github",
  "CHANGELOG.md",
  "README.md",
  "docs",
  "dist/README.md",
  "extension",
  "package.json",
  "scripts",
  "tests"
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

  validateReleaseMetadata(manifest, errors);
  validatePackageScripts(errors);
  validateCiWorkflow(errors);
  validateGitignore(errors);
  validateNoForbiddenReleaseReferences(errors);
  validateHtmlReferences("popup/popup.html", errors);
  validateHtmlReferences("export/export.html", errors);
  validatePngSignature("assets/icons/icon16.png", errors);
  validatePngSignature("assets/icons/icon32.png", errors);
  validatePngSignature("assets/icons/icon48.png", errors);
  validatePngSignature("assets/icons/icon128.png", errors);

  if (!existsSync(path.join(repoRoot, "dist", "README.md"))) {
    errors.push("dist/README.md is missing.");
  }

  validatePackageEntries(collectExtensionPackageEntries(), errors);

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

function readRepoJson(relativePath, errors) {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    errors.push(`Could not parse ${relativePath}: ${error.message}`);
    return null;
  }
}

function validateReleaseMetadata(manifest, errors) {
  const packageJson = readRepoJson("package.json", errors);
  if (!manifest || !packageJson) {
    return;
  }

  if (manifest.version !== packageJson.version) {
    errors.push(`Version mismatch: extension/manifest.json is ${manifest.version}, package.json is ${packageJson.version}.`);
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const latestVersionMatch = changelog.match(/^##\s+([0-9]+\.[0-9]+\.[0-9]+)\b/m);
  if (!latestVersionMatch) {
    errors.push("CHANGELOG.md is missing a latest version heading like `## 1.1.0`.");
  } else if (latestVersionMatch[1] !== manifest.version) {
    errors.push(`CHANGELOG.md latest version is ${latestVersionMatch[1]}, but manifest version is ${manifest.version}.`);
  }
}

function validatePackageScripts(errors) {
  const packageJson = readRepoJson("package.json", errors);
  if (!packageJson) {
    return;
  }

  for (const scriptName of requiredPackageScripts) {
    if (!packageJson.scripts?.[scriptName]) {
      errors.push(`package.json is missing required script: ${scriptName}`);
    }
  }
}

function validateCiWorkflow(errors) {
  if (!existsSync(ciWorkflowPath)) {
    errors.push(".github/workflows/ci.yml is missing.");
    return;
  }

  const workflow = readFileSync(ciWorkflowPath, "utf8");
  for (const command of requiredCiCommands) {
    if (!workflow.includes(command)) {
      errors.push(`CI workflow must run \`${command}\`.`);
    }
  }
}

function validateGitignore(errors) {
  if (!existsSync(gitignorePath)) {
    errors.push(".gitignore is missing.");
    return;
  }

  const gitignore = readFileSync(gitignorePath, "utf8");
  for (const entry of requiredGitignoreEntries) {
    if (!gitignore.split(/\r?\n/).includes(entry)) {
      errors.push(`.gitignore is missing generated artifact entry: ${entry}`);
    }
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

  for (const permission of ["tabs", "tabGroups", "scripting", "storage"]) {
    if (!manifest.permissions?.includes(permission)) {
      errors.push(`manifest.json is missing required permission: ${permission}`);
    }
  }

  for (const permission of ["pageCapture", "downloads"]) {
    if (manifest.permissions?.includes(permission)) {
      errors.push(`manifest.json should request ${permission} as an optional permission, not an install-time permission.`);
    }

    if (!manifest.optional_permissions?.includes(permission)) {
      errors.push(`manifest.json is missing optional permission: ${permission}`);
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

function validateNoForbiddenReleaseReferences(errors) {
  for (const filePath of collectTextFilesForReleaseScan()) {
    const content = readFileSync(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");

    for (const forbiddenReference of forbiddenReleaseReferences) {
      if (content.includes(forbiddenReference)) {
        errors.push(`Removed report artifact reference remains in ${relativePath}: ${forbiddenReference}`);
      }
    }
  }
}

function collectTextFilesForReleaseScan() {
  const files = [];

  for (const scanRoot of scanRoots) {
    const absolutePath = path.join(repoRoot, scanRoot);
    if (!existsSync(absolutePath)) {
      continue;
    }

    collectTextFiles(absolutePath, files);
  }

  return files;
}

function collectTextFiles(absolutePath, files) {
  const stats = statSync(absolutePath);

  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolutePath).sort()) {
      if (entry === "node_modules") {
        continue;
      }

      collectTextFiles(path.join(absolutePath, entry), files);
    }
    return;
  }

  if (!stats.isFile()) {
    return;
  }

  if (textFileExtensions.has(path.extname(absolutePath))) {
    files.push(absolutePath);
  }
}

function collectExtensionPackageEntries(directory = extensionDir, baseDirectory = extensionDir) {
  const entries = [];

  for (const name of readdirSync(directory).sort()) {
    const absolutePath = path.join(directory, name);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      entries.push(...collectExtensionPackageEntries(absolutePath, baseDirectory));
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    entries.push(path.relative(baseDirectory, absolutePath).replaceAll(path.sep, "/"));
  }

  return entries;
}

export function validatePackageEntries(entries, errors = []) {
  for (const entry of entries) {
    const rootEntry = entry.split("/")[0];
    if (!allowedZipRootEntries.has(rootEntry)) {
      errors.push(`Unexpected release package entry: ${entry}`);
    }

    if (entry.includes("..") || path.isAbsolute(entry)) {
      errors.push(`Unsafe release package entry path: ${entry}`);
    }

    if (entry.endsWith(".map")) {
      errors.push(`Source map should not be packaged: ${entry}`);
    }

    if (entry.includes("__tests__") || entry.includes(".test.")) {
      errors.push(`Test file should not be packaged: ${entry}`);
    }

    for (const forbiddenReference of forbiddenReleaseReferences) {
      if (entry.includes(forbiddenReference)) {
        errors.push(`Removed report artifact should not be packaged: ${entry}`);
      }
    }
  }

  if (!entries.includes("manifest.json")) {
    errors.push("Release package must include manifest.json at the ZIP root.");
  }

  return errors;
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
