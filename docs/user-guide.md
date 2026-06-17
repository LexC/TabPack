# TabPack User Guide

TabPack is a Manifest V3 extension for Chromium-based browsers such as
Microsoft Edge and Google Chrome. It exports the tab groups in your current
browser window as local files.

## Install

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
5. Click **Choose folder** and grant read/write access.
6. Click **Scan grouped tabs**.
7. Review the preview, deselect any groups or tabs you do not want, and inspect
   skipped tabs.
8. Click **Export grouped tabs**.

During a long export, click **Stop export** to stop before the next queued page
begins. In-flight browser operations and asset fetches are stopped when the
browser allows it.

## Example Output

By default, TabPack creates a `TabPack` folder inside the output folder you
choose:

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

MHTML mode uses the same group folders with `.mhtml` files. When the report
option is enabled, TabPack writes `tab-groups.csv` at the export root.

## Export Modes

| Mode | Output | Best For |
| --- | --- | --- |
| HTML page, online assets | `1.html` | Lightweight page snapshots that may still load live web assets when opened online. |
| HTML page, local asset paths | `1.html` | Comparing root HTML against asset-folder modes. References point at local folders, but asset folders are not created. |
| HTML page + relevant assets | `1.html` + `1_files/` | The default mode. Saves direct page resources such as scripts, stylesheets, images, icons, media, frames, and `srcset` entries. |
| HTML page + all assets | `1.html` + `1_files/` | A deeper archive that also follows stylesheet `url(...)` and `@import` references recursively. May save many files on large sites. |
| MHTML page archives | `1.mhtml` | Single-file page archives using Chromium's official `chrome.pageCapture.saveAsMHTML` API. |
| CSV page index | `tab-groups.csv` | A selected-page index without saving page content. |

The checkbox **Export report CSV** controls whether `tab-groups.csv` is written.
It is off by default. CSV page index mode requires that checkbox because the CSV
is the export output.

In the relevant-assets mode, stylesheet-internal `url(...)` and `@import`
references are kept as absolute web URLs instead of being followed recursively.
The all-assets mode follows those references and can therefore save many more
files.

HTML snapshot modes are best-effort because Chromium does not expose the
browser's exact native "Save Page Complete" pipeline to extensions. MHTML is the
most official single-file capture path, but it can still fail or produce
imperfect archives on complex or restricted pages.

## What Gets Exported

- Only tabs in the current browser window are scanned.
- Only selected tabs inside browser tab groups are exported; all eligible
  grouped tabs start selected.
- Ungrouped tabs are ignored.
- Only `http://` and `https://` tabs are exported.
- `edge://`, `chrome://`, extension pages, `file://`, `about:blank`, and other
  unsupported URLs are skipped.
- Collapsed tab groups are included when their tabs exist in the current window.

CSV exports include export timestamp, export mode, group order, group name,
group ID, selected order, tab order, tab index, tab ID, cleaned page title, page
URL, file path, and asset folder path.

## Destination Folders

The main export flow uses the File System Access API. Click **Choose folder**
and grant read/write access to the folder where TabPack should write files.
Browsers expose the selected folder name to the extension, but not the full
absolute path.

The checkbox **Create TabPack folder** is enabled by default. When enabled,
group folders are created inside `TabPack/`. When disabled, group folders are
written directly inside the selected folder.

TabPack remembers export mode, filename mode, report CSV preference,
filename-conflict behavior, fallback preference, and the root-folder checkbox
with extension local storage. When the browser allows it, TabPack also remembers
the selected output folder handle. If write permission is no longer granted when
TabPack opens, choose the folder again.

If `window.showDirectoryPicker()` is unavailable, blocked, or write permission
is denied, TabPack shows a clearly labeled fallback option. The fallback writes
to:

```text
Downloads/TabPack/
```

The fallback is never silent. For HTML asset modes, selected-folder export keeps
`N.html` and `N_files/` pairs together more reliably than browser-download
fallback handling.

## File Naming

Group folder names come from visible browser tab group names. Untitled groups
use `Group_<groupId>`. Folder names are sanitized for Windows compatibility, and
duplicate sanitized group names get a deterministic suffix such as
`__group_<groupId>`.

Page files are numbered by selected tab order inside each group by default. If a
tab is deselected, remaining selected tabs are compactly renumbered:

```text
1.html
2.html
3.html
```

Enable **Keep original scan numbers** to preserve the numbering shown at scan
time. If the first tab is deselected, the next selected tab can remain `2.html`
instead of becoming `1.html`.

The filename mode can also use page titles. Title filenames are sanitized for
Windows compatibility, trimmed to 80 characters before the extension, and
uniquified inside each group:

```text
Example Page.html
Example Page (1).html
```

HTML asset modes create paired folders:

```text
1.html
1_files/
2.html
2_files/
```

Enable **Close tabs after successful export** to close only source tabs whose
page export succeeds. Failed, deselected, skipped, and CSV-only tabs stay open.
If page exports fail, **Retry failed tabs** retries only those failed page rows
from the most recent run without rescanning.

MHTML mode writes:

```text
1.mhtml
2.mhtml
3.mhtml
```

CSV mode writes the selected-page index instead of page content:

```text
tab-groups.csv
```

By default, existing files are not overwritten. If `1.html` or `1_files/`
already exists, TabPack writes `1 (1).html` and `1 (1)_files/`. An overwrite
mode is available in the export screen, but it is not the default.

## Privacy

TabPack is designed to stay local.

- No uploads.
- No TabPack backend service.
- No analytics.
- No telemetry.
- No login.
- No export-time refetch of the page URL itself.

HTML asset modes fetch asset URLs referenced by the already-open page so
TabPack can write local `N_files/` folders. Those asset requests may contact the
sites and CDNs already referenced by the page.

See the [Privacy Policy](../PRIVACY.md) for the full policy text.

## Permissions

TabPack requests only the permissions needed to inspect grouped tabs and save
exports.

| Permission | Why It Is Needed |
| --- | --- |
| `tabs` | Read tab titles, URLs, indexes, and window membership for export planning. |
| `tabGroups` | Read browser tab group names, IDs, and ordering. |
| `scripting` | Run the HTML serializer inside exported HTTP/HTTPS tabs. |
| `storage` | Remember export settings. |
| Optional `pageCapture` | Requested at runtime only when exporting MHTML archives. |
| Optional `downloads` | Requested at runtime only when using the explicit `Downloads/TabPack/` fallback. |
| Optional `http://*/*`, `https://*/*` | Requested at runtime for HTML export modes so TabPack can serialize selected web pages and fetch referenced assets. |

HTML export uses the standard `scripting` API when the browser exposes it to the
export page. If that API is unavailable there, TabPack asks its background
service worker to run the same serializer in each exported HTTP/HTTPS tab. CSV
and MHTML modes do not request optional HTTP/HTTPS host access. Selected-folder
exports do not request the optional `downloads` permission.

## Known Limitations

- HTML snapshot and asset modes are best-effort.
- Dynamic resources, protected assets, canvas content, service-worker state,
  cross-origin frames, late-loaded data, or blocked requests may not be
  captured.
- If some assets fail, the `.html` file is still written and the progress log
  reports asset warnings.
- CSV mode is an index only; it does not save page content.
- MHTML capture depends on Chromium support and may fail for restricted,
  internal, or complex pages.
- The browser shows only the chosen folder name to the extension, not its full
  path.
- File System Access support depends on the Edge/Chromium extension page
  context.
- The Downloads fallback always writes below `Downloads/TabPack/`.

## Troubleshooting

- If **Export grouped tabs** is disabled, scan grouped tabs and choose an output
  folder first.
- If every tab is deselected, select at least one tab before exporting.
- If CSV page index export is disabled, enable **Export report CSV**.
- If folder selection is canceled, click **Choose folder** again.
- If write permission is denied, choose the folder again or select another
  folder.
- If selected-folder export is unavailable, use the clearly labeled Downloads
  fallback.
- If an HTML export asks for page access, grant the runtime HTTP/HTTPS
  permission so TabPack can serialize selected pages.
- If an HTML asset mode reports asset warnings, inspect the exported `N_files/`
  folder and retry with MHTML mode for a single-file archive.
- If HTML export says the background serializer is unavailable, reload the
  unpacked extension from the browser extensions page, approve any new
  permissions, and reopen TabPack.
- If HTML export says a script execution API is unavailable, reload the unpacked
  extension from the browser extensions page, approve any new permissions, and
  reopen TabPack.
- If MHTML capture fails for some pages, retry with an HTML mode or export a CSV
  index.
