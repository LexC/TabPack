# Documentation Guide

TabPack documentation should help future maintainers understand intent without
forcing them to read every implementation branch. Keep docs close to the
audience and update them in the same change that changes behavior.

## Where Documentation Belongs

- `README.md`: user-facing behavior, installation, permissions, limitations,
  troubleshooting, and development entrypoints.
- `docs/dev/`: maintainer-focused architecture, coding conventions, local
  verification, and documentation policy.
- `tests/manual/`: step-by-step browser checks that are hard to automate or
  important for store review confidence.
- `docs/store/`: store listing text and store asset preparation notes.
- Code comments: browser constraints, security/privacy decisions, fallback
  behavior, data ownership, and non-obvious failure handling.
- `types/tabpack-globals.d.ts`: cross-file runtime shapes for plain-script
  modules and `@ts-check`.

## Code Comment Style

- Explain why a module or branch exists, especially around browser APIs,
  permissions, File System Access, Downloads fallback, serializer injection, and
  asset capture.
- Prefer module headers and short JSDoc blocks for public factory functions,
  lifecycle functions, and browser boundary functions.
- Avoid comments that repeat the next line of code, such as "set the text" or
  "loop over groups".
- Update stale comments immediately when behavior changes. A missing comment is
  better than a confident wrong one.
- Keep comments ASCII unless the surrounding file already uses non-ASCII text.

## Behavior Changes

When behavior changes, update the closest docs:

- Export modes, file naming, destination behavior, privacy, permissions, or
  limitations: update `README.md`.
- Maintainer architecture, module split, scripts, or tooling: update
  `docs/dev/`.
- Manual browser steps or expected UI copy: update `tests/manual/`.
- Store-facing claims, screenshots, or promotional wording: update `docs/store/`.
- New test fixtures or generated artifacts: update `.gitignore` or validation
  docs when needed.

## Review Checklist

- The user-facing docs still match the extension UI and export behavior.
- Developer docs describe the current module boundaries and script load order.
- Comments explain intent or constraints, not obvious mechanics.
- New public globals or shared data shapes are reflected in
  `types/tabpack-globals.d.ts`.
- Validation and typecheck commands still cover the documented files.
