# TabPack

TabPack saves tabs in groups: it is a local Chromium browser extension that exports tabs from browser tab groups in the current window. Each tab group becomes a folder, and each grouped HTTP/HTTPS tab becomes a numbered file in the same left-to-right order shown in the tab strip.

By default, exports are written under a `TabPack` folder inside a folder you choose:

```text
Selected output folder/
  TabPack/
    Group1/
      1.html
      1_files/
    Group2/
      1.html
      1_files/
      2.html
      2_files/
      3.html
      3_files/
```

MHTML mode uses the same group folder structure with `.mhtml` files. CSV mode writes a single index at the export root.

## Export Modes

**HTML page, online assets (`.html`)** injects a serializer into each grouped page, clones the current document, and saves a numbered HTML snapshot such as `1.html`. It does not write a matching `_files/` folder. Resource URLs are kept as absolute web URLs where practical, so the file may still load live web assets when opened online.

**HTML page, local asset paths (`.html`)** saves only `1.html`, but rewrites direct page resource references to local paths such as `./1_files/example`. It does not create or download the matching `_files/` folder. This mode is useful for comparing the root HTML against the asset-folder modes.

**HTML page + relevant assets (`.html + _files`)** is the default mode. It saves `1.html` plus `1_files/` using a conservative asset set: direct page resources such as scripts, stylesheets, images, icons, media, frames, and `srcset` entries are saved locally. Stylesheet-internal `url(...)` and `@import` references are rewritten to absolute web URLs instead of recursively downloading every referenced asset. This is intended to be closer to Chromium's native "Save Page Complete" folder shape, but Chromium does not expose that exact internal pipeline to extensions.

**HTML page + all assets (`.html + _files`)** uses the same root HTML local-path references as relevant-assets mode, then follows stylesheet `url(...)` and `@import` references recursively while writing asset files. This may save many more files than the browser's native save for large sites.

**MHTML page archive (`.mhtml`)** uses Chromium's `chrome.pageCapture.saveAsMHTML` API. It is the most official extension API for offline page capture, but output is a single `.mhtml` file rather than `1.html` plus `1_files/`. Some pages may still fail or archive imperfectly.

**CSV page index (`.csv`)** creates one `tab-groups.csv` file for the scanned grouped tabs. It includes export timestamp, group order, group ID, group name, tab order, tab index, tab ID, cleaned page title, and page URL.

## User-Selected Folder Export

The primary export path uses the File System Access API. Click **Choose output folder** before exporting, then grant read/write access to the chosen folder. The browser exposes the selected folder name to the extension, but it does not expose the full absolute path.

The checkbox **Create TabPack root folder inside selected output folder** is enabled by default. When enabled, group folders are created inside `TabPack/`. When disabled, group folders are written directly inside the selected folder.

TabPack is not limited to `Downloads/TabPack`. The user-selected folder flow is the main workflow.

## Downloads Fallback

If `window.showDirectoryPicker()` is unavailable, blocked, or write permission is denied, the extension shows a clearly labeled fallback option. The fallback writes to:

```text
Downloads/TabPack/
```

The fallback is not silent and does not use repeated save dialogs for every file. For HTML asset modes, selected-folder export keeps `N.html` and `N_files/` pairs together more reliably than the Downloads fallback.

## Install for Development

1. Open `edge://extensions` in Microsoft Edge or `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` folder inside this project.

## Project Structure

Runtime extension files live under `extension/`. Repo-level files are for documentation, validation, testing, and release packaging.

```text
extension/
  manifest.json
  background/
  popup/
  export/
  shared/
  assets/icons/
docs/store/
scripts/
dist/
```

Store ZIPs should contain the contents of `extension/` at the ZIP root, with `manifest.json` directly inside the archive.

## Release Packaging

Run validation and build release ZIPs with:

```text
npm run validate
npm run build
```

`npm run build:edge` writes `dist/tabpack-edge-<version>.zip`. `npm run build:chrome` writes `dist/tabpack-chrome-<version>.zip`. Generated ZIP files are ignored by git.

## Use

1. Open tabs in the browser and place the tabs you want to export into tab groups.
2. Click the TabPack extension button.
3. Click **Open TabPack**.
4. Choose an export mode.
5. Click **Choose output folder** and grant read/write access.
6. Click **Scan grouped tabs**.
7. Review the preview.
8. Click **Export grouped tabs**.
9. During a long export, click **Stop export** to stop before the next queued page begins. In-flight asset fetches are aborted when the browser allows it.

## What Gets Exported

- Only tabs in the current browser window are scanned.
- Only tabs inside browser tab groups are exported.
- Ungrouped tabs are ignored.
- Only `http://` and `https://` tabs are exported.
- `edge://`, `chrome://`, extension pages, `file://`, `about:blank`, and other unsupported URLs are skipped.
- Collapsed tab groups are included when their tabs exist in the current window.

## File and Folder Names

Group folder names come from visible browser tab group names. Untitled groups use `Group_<groupId>`. Folder names are sanitized for Windows compatibility, and duplicate sanitized group names get a deterministic suffix such as `__group_<groupId>`.

HTML page modes write:

```text
1.html
2.html
```

The local-asset-paths HTML mode points at `1_files/`, `2_files/`, and so on, but does not create those folders.

HTML asset modes write paired output:

```text
1.html
1_files/
2.html
2_files/
```

MHTML mode writes:

```text
1.mhtml
2.mhtml
3.mhtml
```

CSV mode writes one file at the export root:

```text
tab-groups.csv
```

Page titles are not used in filenames.

By default, existing files are not overwritten. In HTML asset modes, conflicts are handled as pairs: if `1.html` or `1_files/` already exists, TabPack saves `1 (1).html` and `1 (1)_files/`. An overwrite mode is available but is not the default. In HTML page modes, only the `.html` filename is uniquified or overwritten.

## Privacy and Security

- Fully local extension.
- No uploads.
- No external servers.
- No analytics.
- No telemetry.
- No login.
- No export-time refetch of the page URL itself.
- HTML asset modes fetch page assets referenced by the already-open page so they can write local `N_files/` folders.

## Permissions

TabPack requests `tabs`, `tabGroups`, `pageCapture`, `downloads`, and `scripting`. It also requests `http://*/*` and `https://*/*` host permissions so it can serialize open HTTP/HTTPS pages and fetch referenced assets for HTML asset modes.

HTML export uses the standard `scripting` API when the browser exposes it to the export page. If that API is unavailable there, TabPack asks its background service worker to run the same serializer in each exported HTTP/HTTPS tab.

## Known Limitations

- HTML snapshot and asset modes are best-effort. Chromium browsers do not expose the exact native "Save Page Complete" implementation to extensions.
- Dynamic resources, protected assets, canvas content, service-worker state, cross-origin frames, late-loaded data, or blocked requests may not be captured.
- If some assets fail, the `.html` file is still written and the progress log reports asset warnings.
- CSV mode is an index only; it does not save page content.
- MHTML capture depends on Chromium support and may fail for restricted, internal, or complex pages.
- The browser shows only the chosen folder name to the extension, not its full path.
- File System Access support depends on the Edge/Chromium extension page context.
- The Downloads fallback always writes below `Downloads/TabPack/`.

## Troubleshooting

- If **Export grouped tabs** is disabled, scan grouped tabs and choose an output folder first.
- If folder selection is canceled, click **Choose output folder** again.
- If write permission is denied, choose the folder again or select another folder.
- If selected-folder export is unavailable, use the clearly labeled Downloads fallback.
- If an HTML asset mode reports asset warnings, inspect the exported `N_files/` folder and retry with MHTML mode for a single-file archive.
- If HTML export says the background serializer is unavailable, reload the unpacked extension from the browser extensions page, approve any new permissions, and reopen TabPack.
- If HTML export says a script execution API is unavailable, reload the unpacked extension from the browser extensions page, approve any new permissions, and reopen TabPack.
- If MHTML capture fails for some pages, retry with an HTML mode or export a CSV index.
