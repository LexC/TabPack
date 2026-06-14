# TabPack Manual Testing

Do not mark browser testing complete unless this unpacked extension has been loaded and tested in Microsoft Edge.

## Setup

- [ ] Open `edge://extensions`.
- [ ] Enable **Developer mode**.
- [ ] Click **Load unpacked** and select this project's `extension` folder.
- [ ] Pin or open the TabPack extension action.
- [ ] Click **Open TabPack** to open `export/export.html`.

Notes:

```text

```

## Static And Packaging Checks

- [ ] Run `npm run validate`.
- [ ] Run `npm run build`.
- [ ] Confirm `dist/tabpack-edge-<version>.zip` exists.
- [ ] Confirm `dist/tabpack-chrome-<version>.zip` exists.
- [ ] Inspect each ZIP and confirm `manifest.json` is at the ZIP root, not under `extension/`.
- [ ] Confirm generated ZIP files are not staged for commit.

Notes:

```text

```

## Prerequisites

- [ ] Microsoft Edge with tab groups enabled.
- [ ] A custom writable test folder outside Downloads, such as Desktop or Documents.
- [ ] Several HTTP/HTTPS tabs available for grouping.
- [ ] At least one unsupported tab available, such as `edge://settings`.
- [ ] Optional: keep the sample `correct/` folder available for structural comparison.

Notes:

```text

```

## 1. One Group With One HTTP/HTTPS Tab

- [ ] Create one tab group containing one HTTP/HTTPS tab.
- [ ] Choose **HTML page + relevant assets (.html + _files)**.
- [ ] Click **Choose output folder** and select a custom folder.
- [ ] Click **Scan grouped tabs**.
- [ ] Confirm the preview shows one group folder, `1.html`, and `1_files/`.
- [ ] Click **Export grouped tabs**.

Expected result: `1.html` and `1_files/` are saved under the selected folder, inside `TabPack/<group-name>/` when the root-folder checkbox is enabled.

Notes:

```text

```

## 2. One Group With Multiple HTTP/HTTPS Tabs

- [ ] Create one group containing at least three HTTP/HTTPS tabs.
- [ ] Arrange tabs left to right in a known order.
- [ ] Scan and export in **HTML page + relevant assets (.html + _files)** mode.

Expected result: files are named `1.html`, `2.html`, `3.html`, each with matching `1_files/`, `2_files/`, `3_files/` folders in visual left-to-right order.

Notes:

```text

```

## 3. Multiple Groups

- [ ] Create at least three tab groups with different names.
- [ ] Place them in a known left-to-right group order.
- [ ] Scan grouped tabs.

Expected result: preview orders groups by the first eligible tab in each group.

Notes:

```text

```

## 4. Ungrouped Tabs Mixed Between Grouped Tabs

- [ ] Place ungrouped HTTP/HTTPS tabs before, between, and after grouped tabs.
- [ ] Scan grouped tabs.

Expected result: ungrouped tabs appear as skipped and are not exported.

Notes:

```text

```

## 5. Collapsed Tab Groups

- [ ] Create a tab group with HTTP/HTTPS tabs.
- [ ] Collapse the group.
- [ ] Scan and export.

Expected result: collapsed group tabs are included if they exist in the current window.

Notes:

```text

```

## 6. Unsupported Browser URLs

- [ ] Add `edge://settings` to a tab group.
- [ ] Scan grouped tabs.

Expected result: the `edge://settings` tab is skipped as an unsupported URL.

Notes:

```text

```

## 7. Non-HTTP/HTTPS URLs

- [ ] Add `about:blank` and a `file://` tab to a tab group.
- [ ] Scan grouped tabs.

Expected result: non-HTTP/HTTPS tabs are skipped and not exported.

Notes:

```text

```

## 8. Duplicate Group Names

- [ ] Create two tab groups with the same visible name.
- [ ] Scan grouped tabs.

Expected result: folders remain separate; the duplicate sanitized name gets a suffix like `__group_<groupId>`.

Notes:

```text

```

## 9. Invalid Windows Filename Characters

- [ ] Name a group with characters like `< > : " / \ | ? *`.
- [ ] Scan and export.

Expected result: the folder name is sanitized and export succeeds.

Notes:

```text

```

## 10. Very Long Group Names

- [ ] Give a group a very long name.
- [ ] Scan and export.

Expected result: the folder name is shortened to a safe length and export succeeds.

Notes:

```text

```

## 11. Existing Output Files

- [ ] Export a group once in an HTML asset mode.
- [ ] Export the same group again with conflict behavior set to **Uniquify existing files**.

Expected result: existing files are preserved and new paired output is saved as `1 (1).html` plus `1 (1)_files/`.

Notes:

```text

```

## 12. Conflict Behavior in Uniquify Mode

- [ ] Manually create `1.html` and `1_files/` in a planned group folder.
- [ ] Export with uniquify mode.

Expected result: TabPack saves the next available pair, such as `1 (1).html` plus `1 (1)_files/`.

Notes:

```text

```

## 13. Overwrite Mode

- [ ] Export a group once in an HTML asset mode.
- [ ] Change conflict behavior to **Overwrite existing files**.
- [ ] Export the same group again.

Expected result: matching `N.html` files and `N_files/` folders are replaced.

Notes:

```text

```

## 14. Compare Against `correct/` Folder Shape

- [ ] Export the same tab groups used for the sample `correct/` folder into a new custom selected folder.
- [ ] Compare group folder names.
- [ ] Compare numeric page filenames.
- [ ] Confirm each exported `N.html` has a matching `N_files/` folder.

Expected result: the exported structure matches the visible shape of `correct/`, though file sizes and exact asset contents may differ because HTML asset modes are best-effort.

Notes:

```text

```

## 15. HTML Asset References

- [ ] Open an exported `N.html` file in a text editor.
- [ ] Search for references like `./N_files/`.
- [ ] Open the same file in Edge from disk.

Expected result: the HTML references local `N_files/` assets, and the page opens from disk with captured assets where available.

Notes:

```text

```

## 16. Asset Fetch Failures

- [ ] Export a complex or protected page in an HTML asset mode.
- [ ] Watch the progress log.

Expected result: blocked or failed assets are logged as warnings. The tab is not counted as failed if the main `N.html` file and asset folder are written.

Notes:

```text

```

## 17. MHTML Capture Failures

- [ ] Select **MHTML page archives (.mhtml)** mode.
- [ ] Include pages likely to reject or fail capture.
- [ ] Export.

Expected result: failed captures are logged, failure count increases, and remaining tabs continue exporting.

Notes:

```text

```

## 18. CSV Page Index Mode

- [ ] Select **CSV page index (.csv)** mode.
- [ ] Export grouped tabs.
- [ ] Open the exported `tab-groups.csv` file.

Expected result: one CSV file is written at the export root. It contains rows for grouped HTTP/HTTPS tabs with group name, order, cleaned title, URL, tab index, and tab ID. It does not include a `group_folder` column.

Notes:

```text

```

## 19. User Cancels Output Folder Picker

- [ ] Click **Choose output folder**.
- [ ] Cancel the picker.

Expected result: the UI reports cancellation without crashing, and export remains disabled until a folder or fallback is selected.

Notes:

```text

```

## 20. User Selects a Folder Successfully

- [ ] Click **Choose output folder**.
- [ ] Select a writable folder.
- [ ] Grant read/write access.

Expected result: the selected folder name is shown with a note that Edge does not expose the full path to extension pages.

Notes:

```text

```

## 21. Custom Folder Outside Downloads

- [ ] Select a custom folder outside Downloads.
- [ ] Export grouped tabs in **HTML page + relevant assets (.html + _files)** mode.
- [ ] Inspect that custom folder.
- [ ] Inspect Downloads.

Expected result: exported files appear under the selected custom folder, not only under `Downloads/TabPack`.

Notes:

```text

```

## 22. Root Folder Enabled

- [ ] Keep **Create TabPack root folder inside selected output folder** checked.
- [ ] Export.

Expected result: files are under `Selected output folder/TabPack/<group-folder>/`.

Notes:

```text

```

## 23. Root Folder Disabled

- [ ] Uncheck **Create TabPack root folder inside selected output folder**.
- [ ] Export.

Expected result: group folders are written directly inside the selected folder.

Notes:

```text

```

## 24. Browser Does Not Support showDirectoryPicker

- [ ] Test in a context where `window.showDirectoryPicker` is unavailable, or temporarily simulate the missing API during development.

Expected result: the UI explains selected-folder export is unavailable and reveals the explicit Downloads fallback option.

Notes:

```text

```

## 25. Downloads Fallback

- [ ] Trigger or simulate unavailable selected-folder export.
- [ ] Check **Use fallback export to Downloads/TabPack**.
- [ ] Scan and export.

Expected result: files are saved under `Downloads/TabPack/`, and the UI clearly labels this as fallback behavior.

Notes:

```text

```

## 26. Confirm Not Downloads-Only

- [ ] Repeat a selected-folder export to a custom folder outside Downloads.
- [ ] Confirm no required step forces use of Downloads.

Expected result: the primary workflow writes to the selected folder.

Notes:

```text

```

## 27. MHTML Offline Opening

- [ ] Export a simple public webpage in MHTML mode.
- [ ] Disconnect from the network or use a known offline check.
- [ ] Open the `.mhtml` file in Edge.

Expected result: the MHTML opens offline where Chromium captured the page successfully.

Notes:

```text

```

## 28. HTML Page Online Assets Mode

- [ ] Select **HTML page, online assets (.html)** mode.
- [ ] Scan and export grouped HTTP/HTTPS tabs.
- [ ] Inspect the group folder.

Expected result: each tab writes a numeric `.html` file only. No matching `N_files/` folder is created, and resource URLs in the HTML are absolute web URLs where practical.

Notes:

```text

```

## 29. HTML Page Local Asset Paths Mode

- [ ] Select **HTML page, local asset paths (.html)** mode.
- [ ] Scan and export grouped HTTP/HTTPS tabs.
- [ ] Inspect the group folder and exported HTML.

Expected result: each tab writes a numeric `.html` file only. No matching `N_files/` folder is created, but the HTML points at local paths such as `./1_files/...`.

Notes:

```text

```

## 30. HTML Relevant Assets Mode

- [ ] Select **HTML page + relevant assets (.html + _files)** mode.
- [ ] Export a page with scripts, stylesheets, images, and icons.
- [ ] Inspect `N.html` and `N_files/`.

Expected result: `N.html` references local direct assets in `N_files/`. Stylesheet-internal `url(...)` and `@import` references may remain absolute web URLs instead of being downloaded recursively.

Notes:

```text

```

## 31. HTML All Assets Mode

- [ ] Select **HTML page + all assets (.html + _files)** mode.
- [ ] Export the same complex page used in relevant-assets mode.
- [ ] Compare the number of files in both `N_files/` folders.

Expected result: all-assets mode preserves the previous broad capture behavior and may create many more files because it recursively follows stylesheet `url(...)` and `@import` references.

Notes:

```text

```

## 32. Export Mode List Order

- [ ] Open TabPack.
- [ ] Inspect the export mode selector.

Expected result: the visible order is **HTML page, online assets (.html)**, **HTML page, local asset paths (.html)**, **HTML page + relevant assets (.html + _files)**, **HTML page + all assets (.html + _files)**, **MHTML page archives (.mhtml)**, and **CSV page index (.csv)**.

Notes:

```text

```

## 33. Progress Log And Overall Progress

- [ ] Export a group with multiple HTTP/HTTPS tabs.
- [ ] Watch the progress panel above the detailed log.
- [ ] Inspect the detailed log rows.

Expected result: the progress panel shows the overall percentage and completed/total pages. Detailed log badges have a consistent width so messages start at the same horizontal position.

Notes:

```text

```

## 34. Stop Export

- [ ] Export multiple grouped HTTP/HTTPS tabs using **HTML page + all assets (.html + _files)**.
- [ ] Click **Stop export** while export is running.
- [ ] Watch the progress panel and detailed log.

Expected result: the Stop button disables after the stop request, in-flight asset fetches are aborted where the browser allows it, no new tab export starts, and the progress panel reports that export was stopped by the user.

Notes:

```text

```
