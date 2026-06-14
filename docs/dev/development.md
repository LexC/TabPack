# TabPack Developer Guide

TabPack is a plain Manifest V3 extension. Runtime files are loaded directly by
Chrome/Edge with script tags or `importScripts`; there is no bundler and no
compiled output for extension code.

## Runtime Architecture

- `extension/shared/constants.js` owns cross-page constants and mode names.
- `extension/shared/browser-api.js` is the callback-to-Promise boundary for
  browser APIs. Extension pages should call this wrapper instead of using
  callback-style `chrome.*` APIs directly.
- `extension/shared/export-helpers.js` contains pure export planning, filename,
  path, CSV, and tab-eligibility logic. Keep browser, DOM, and filesystem side
  effects out of this file so it stays easy to unit test.
- `extension/popup/` is the small summary surface that opens the export page.
- `extension/background/service-worker.js` handles background serializer fallback
  messages for browsers that cannot execute the serializer from the export page.
- `extension/export/export.js` is the export page entrypoint. It owns page state,
  bootstrapping, preferences, scanning, and high-level export orchestration.
- `extension/export/export-renderer.js` owns preview, skipped-tab rendering,
  progress, counters, and log output.
- `extension/export/export-destination.js` owns folder selection, remembered
  directory handles, File System Access permission checks, and Downloads fallback
  visibility.
- `extension/export/export-writer.js` owns selected-folder writes, Downloads
  fallback downloads, conflict handling, CSV blobs, and export result records.
- `extension/export/html-capture.js` owns HTML serialization, asset fetching,
  stylesheet URL rewriting, MHTML capture, and asset warning reporting.
- `extension/export/page-serializer.js` is injected into exported pages. It must
  stay self-contained because the browser serializes the function body into tabs.

## Script Load Order

The export page intentionally loads scripts in dependency order:

```html
../shared/constants.js
../shared/browser-api.js
../shared/export-helpers.js
page-serializer.js
html-capture.js
export-renderer.js
export-destination.js
export-writer.js
export.js
```

The shared public globals are `TabPackConstants`, `TabPackBrowserApi`, and
`TabPackExportHelpers`. Export-page-only modules expose internal `TabPack...`
factory globals so the entrypoint can compose them without a build step.

## Coding Conventions

- Add `// @ts-check` to JavaScript and document cross-file shapes in
  `types/tabpack-globals.d.ts`.
- Keep pure logic in `shared/export-helpers.js`; keep DOM writes in renderer
  modules; keep browser/filesystem effects behind focused modules.
- Prefer small named functions over inline branching in event handlers.
- Add comments where they explain browser-extension constraints or non-obvious
  failure handling. Avoid comments that restate obvious assignments.
- Keep permissions minimal and document any permission change in README.
- Do not commit generated `node_modules/`, `dist/*.zip`, Playwright reports, or
  `test-results/`.

## Related Guides

- [Documentation Guide](documentation.md)
- [Testing and Release Checks](testing.md)
