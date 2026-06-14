# Setup And Release Checks

## Browser Setup

- [ ] Open `edge://extensions`.
- [ ] Enable Developer mode.
- [ ] Click Load unpacked and select this repository's `extension/` folder.
- [ ] Pin or open the TabPack extension action.
- [ ] Click Open TabPack and confirm `export/export.html` opens.

## Static Checks

- [ ] Run `npm run validate`.
- [ ] Run `npm run build`.
- [ ] Confirm `dist/tabpack-edge-<version>.zip` exists.
- [ ] Confirm `dist/tabpack-chrome-<version>.zip` exists.
- [ ] Inspect both ZIPs and confirm `manifest.json` is at the ZIP root.
- [ ] Confirm generated ZIP files are not staged for commit.

## Notes

```text

```
