# Testing and Release Checks

Use these commands from the repository root.

## Local Checks

```text
npm run typecheck
npm test
npm run validate
npm run build
npm run check
```

`npm run check` is the full release gate. It runs type checking, unit tests, e2e
tests, extension validation, and release ZIP generation.

## WSL Notes

In WSL, Playwright and Node tooling can inherit Windows temp paths. Use Linux
temp paths when running the full gate from this environment:

```text
TMPDIR=/tmp TMP=/tmp TEMP=/tmp npm run check
```

Playwright e2e tests bind a local `127.0.0.1` server. Sandboxed automation may
need explicit permission for that local listener.

## Generated Artifacts

These are expected local outputs and should not be committed:

- `node_modules/`
- `node_modules/.package-lock.json`
- `dist/*.zip`
- `test-results/`
- `playwright-report/`
- `blob-report/`

`npm run build:edge` writes `dist/tabpack-edge-<version>.zip`.
`npm run build:chrome` writes `dist/tabpack-chrome-<version>.zip`.

## Before Packaging

- Run `TMPDIR=/tmp TMP=/tmp TEMP=/tmp npm run check`.
- Confirm `git status --short` contains only intentional source, docs, test, and
  package metadata changes.
- Do not use files under `dist/` as source documentation; they are release
  outputs.
