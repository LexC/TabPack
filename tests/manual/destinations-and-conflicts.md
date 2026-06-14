# Destinations And Conflicts

## Selected Folder

- [ ] Choose a writable folder outside Downloads.
- [ ] Keep Create TabPack root folder enabled and export.
- [ ] Confirm output appears under `Selected folder/TabPack/`.
- [ ] Confirm `tab-groups.csv` and `tabpack-export-report.json` appear at the export root.
- [ ] Disable Create TabPack root folder and export again.
- [ ] Confirm group folders are written directly inside the selected folder.
- [ ] Confirm `tab-groups.csv` and `tabpack-export-report.json` move with the selected export root.

## Remembered Folder

- [ ] Choose a folder, close TabPack, reopen TabPack.
- [ ] Confirm the folder is restored if Edge still grants write permission.
- [ ] If permission is not granted, confirm the UI asks you to choose the folder again.

## Conflict Behavior

- [ ] Export once with Uniquify existing files.
- [ ] Export again with Uniquify existing files.
- [ ] Confirm existing files remain and new files use suffixes such as `1 (1).html`.
- [ ] Export again with Overwrite existing files.
- [ ] Confirm matching files and `_files/` folders are replaced.

## Downloads Fallback

- [ ] Simulate or use a browser context where `showDirectoryPicker` is unavailable or denied.
- [ ] Confirm the Downloads fallback is clearly shown and must be explicitly checked.
- [ ] Export and confirm files are written under `Downloads/TabPack/`.
- [ ] Confirm the fallback also queues `Downloads/TabPack/tab-groups.csv` and `Downloads/TabPack/tabpack-export-report.json`.

## Notes

```text

```
