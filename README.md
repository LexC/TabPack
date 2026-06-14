# TabPack

**Save browser tab groups as local files.**

TabPack is a free and open-source Chromium browser extension for exporting the tab groups in your current window. It turns each browser tab group into a folder, then saves grouped HTTP/HTTPS tabs as HTML snapshots, HTML asset folders, MHTML archives, or a CSV index.

It is built for people who use tab groups as working sets: research sessions, project references, reading queues, investigations, documentation trails, and anything else worth keeping outside the browser.

## Highlights

- Free and open-source under the MIT License.
- Local-first: no login, no analytics, no telemetry, and no uploads.
- Exports only tabs in browser tab groups, so ungrouped browsing stays out of the archive.
- Preserves browser tab-group order and tab order in deterministic numbered files.
- Lets you deselect specific groups or tabs before export; everything eligible is selected by default.
- Supports HTML, HTML + `_files` folders, MHTML, and CSV exports.
- Writes to a folder you choose with the File System Access API when available.
- Remembers export settings and best-effort output folder access when the browser keeps permission.
- Provides an explicit `Downloads/TabPack/` fallback when selected-folder export is unavailable.
- Shows a popup summary, preview, skipped tabs, progress counters, and export log before and during export.

## Example Output

By default, TabPack creates a `TabPack` folder inside the output folder you choose:

```text
Selected output folder/
  TabPack/
    Research/
      1.html
      1_files/
      2.html
      2_files/
    Reading Queue/
      1.html
      1_files/
```

MHTML mode uses the same group folders with `.mhtml` files. CSV mode writes one `tab-groups.csv` file at the export root.

## Install

TabPack is a Manifest V3 extension for Chromium-based browsers such as Microsoft Edge and Google Chrome.

1. Clone or download this repository.
2. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension/` folder inside this project.

## Quick Start

1. Put the tabs you want to export into browser tab groups.
2. Click the TabPack extension button.
3. Click **Open TabPack**.
4. Choose an export mode.
5. Click **Choose output folder** and grant read/write access.
6. Click **Scan grouped tabs**.
7. Review the preview, deselect any groups or tabs you do not want, and inspect skipped tabs.
8. Click **Export grouped tabs**.

During a long export, click **Stop export** to stop before the next queued page begins. In-flight browser operations and asset fetches are stopped when the browser allows it.

## Export Modes

| Mode | Output | Best For |
| --- | --- | --- |
| HTML page, online assets | `1.html` | Lightweight page snapshots that may still load live web assets when opened online. |
| HTML page, local asset paths | `1.html` | Comparing root HTML against asset-folder modes. References point at local folders, but asset folders are not created. |
| HTML page + relevant assets | `1.html` + `1_files/` | The default mode. Saves direct page resources such as scripts, stylesheets, images, icons, media, frames, and `srcset` entries. |
| HTML page + all assets | `1.html` + `1_files/` | A deeper archive that also follows stylesheet `url(...)` and `@import` references recursively. May save many files on large sites. |
| MHTML page archives | `1.mhtml` | Single-file page archives using Chromium's official `chrome.pageCapture.saveAsMHTML` API. |
| CSV page index | `tab-groups.csv` | An audit index of selected, deselected, and skipped tabs without saving page content. |

In the relevant-assets mode, stylesheet-internal `url(...)` and `@import` references are kept as absolute web URLs instead of being followed recursively. The all-assets mode follows those references and can therefore save many more files.

HTML snapshot modes are best-effort because Chromium does not expose the browser's exact native "Save Page Complete" pipeline to extensions. MHTML is the most official single-file capture path, but it can still fail or produce imperfect archives on complex or restricted pages.

## What Gets Exported

- Only tabs in the current browser window are scanned.
- Only selected tabs inside browser tab groups are exported; all eligible grouped tabs start selected.
- Ungrouped tabs are ignored.
- Only `http://` and `https://` tabs are exported.
- `edge://`, `chrome://`, extension pages, `file://`, `about:blank`, and other unsupported URLs are skipped.
- Collapsed tab groups are included when their tabs exist in the current window.

CSV exports include export timestamp, row status, selected state, skip reason, export mode, group order, group ID, group name, group folder, tab order, selected order, tab index, tab ID, cleaned page title, page URL, planned file path, and planned asset folder path.

## Destination Folders

The main export flow uses the File System Access API. Click **Choose output folder** and grant read/write access to the folder where TabPack should write files. Browsers expose the selected folder name to the extension, but not the full absolute path.

The checkbox **Create TabPack root folder inside selected output folder** is enabled by default. When enabled, group folders are created inside `TabPack/`. When disabled, group folders are written directly inside the selected folder.

TabPack remembers export mode, filename-conflict behavior, fallback preference, and the root-folder checkbox with extension local storage. When the browser allows it, TabPack also remembers the selected output folder handle. If write permission is no longer granted when TabPack opens, choose the folder again.

If `window.showDirectoryPicker()` is unavailable, blocked, or write permission is denied, TabPack shows a clearly labeled fallback option. The fallback writes to:

```text
Downloads/TabPack/
```

The fallback is never silent. For HTML asset modes, selected-folder export keeps `N.html` and `N_files/` pairs together more reliably than browser-download fallback handling.

## File Naming

Group folder names come from visible browser tab group names. Untitled groups use `Group_<groupId>`. Folder names are sanitized for Windows compatibility, and duplicate sanitized group names get a deterministic suffix such as `__group_<groupId>`.

Page files are numbered by selected tab order inside each group. If a tab is deselected, remaining selected tabs are compactly renumbered:

```text
1.html
2.html
3.html
```

HTML asset modes create paired folders:

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

CSV mode writes one audit file:

```text
tab-groups.csv
```

Page titles are not used in filenames. By default, existing files are not overwritten. If `1.html` or `1_files/` already exists, TabPack writes `1 (1).html` and `1 (1)_files/`. An overwrite mode is available in the export screen, but it is not the default.

## Privacy

TabPack is designed to stay local.

- No uploads.
- No TabPack backend service.
- No analytics.
- No telemetry.
- No login.
- No export-time refetch of the page URL itself.

HTML asset modes fetch asset URLs referenced by the already-open page so TabPack can write local `N_files/` folders. Those asset requests may contact the sites and CDNs already referenced by the page.

## Permissions

TabPack requests only the permissions needed to inspect grouped tabs and save exports.

| Permission | Why It Is Needed |
| --- | --- |
| `tabs` | Read tab titles, URLs, indexes, and window membership for export planning. |
| `tabGroups` | Read browser tab group names, IDs, and ordering. |
| `pageCapture` | Save tabs as MHTML archives. |
| `downloads` | Provide the explicit `Downloads/TabPack/` fallback. |
| `scripting` | Run the HTML serializer inside exported HTTP/HTTPS tabs. |
| `storage` | Remember export settings. |
| Optional `http://*/*`, `https://*/*` | Requested at runtime for HTML export modes so TabPack can serialize selected web pages and fetch referenced assets. |

HTML export uses the standard `scripting` API when the browser exposes it to the export page. If that API is unavailable there, TabPack asks its background service worker to run the same serializer in each exported HTTP/HTTPS tab. CSV and MHTML modes do not request optional HTTP/HTTPS host access.

## Known Limitations

- HTML snapshot and asset modes are best-effort.
- Dynamic resources, protected assets, canvas content, service-worker state, cross-origin frames, late-loaded data, or blocked requests may not be captured.
- If some assets fail, the `.html` file is still written and the progress log reports asset warnings.
- CSV mode is an index only; it does not save page content.
- MHTML capture depends on Chromium support and may fail for restricted, internal, or complex pages.
- The browser shows only the chosen folder name to the extension, not its full path.
- File System Access support depends on the Edge/Chromium extension page context.
- The Downloads fallback always writes below `Downloads/TabPack/`.

## Troubleshooting

- If **Export grouped tabs** is disabled, scan grouped tabs and choose an output folder first.
- If every tab is deselected, select at least one tab or use CSV mode to write an audit index.
- If folder selection is canceled, click **Choose output folder** again.
- If write permission is denied, choose the folder again or select another folder.
- If selected-folder export is unavailable, use the clearly labeled Downloads fallback.
- If an HTML export asks for page access, grant the runtime HTTP/HTTPS permission so TabPack can serialize selected pages.
- If an HTML asset mode reports asset warnings, inspect the exported `N_files/` folder and retry with MHTML mode for a single-file archive.
- If HTML export says the background serializer is unavailable, reload the unpacked extension from the browser extensions page, approve any new permissions, and reopen TabPack.
- If HTML export says a script execution API is unavailable, reload the unpacked extension from the browser extensions page, approve any new permissions, and reopen TabPack.
- If MHTML capture fails for some pages, retry with an HTML mode or export a CSV index.

## Development

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
tests/
```

Run automated tests:

```text
npm test
```

Run validation:

```text
npm run validate
```

Build release ZIPs:

```text
npm run build
```

`npm run build:edge` writes `dist/tabpack-edge-<version>.zip`. `npm run build:chrome` writes `dist/tabpack-chrome-<version>.zip`. Generated ZIP files are ignored by git.

Store ZIPs contain the contents of `extension/` at the ZIP root, with `manifest.json` directly inside the archive.

## Contributing

Issues, fixes, documentation improvements, and careful feature ideas are welcome. Please keep changes aligned with TabPack's core promise: local-first tab-group export with clear user control over what gets written and where.

## License

TabPack is free and open-source software released under the [MIT License](LICENSE).
