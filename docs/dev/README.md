# Developer Guides

These guides cover the parts of TabPack that future contributors need to keep
stable: the no-build extension architecture, documentation standards, and local
verification workflow.

## Guides

- [TabPack Developer Guide](development.md): runtime architecture, script load
  order, module boundaries, and coding conventions.
- [Documentation Guide](documentation.md): where different kinds of
  documentation belong and how to keep code comments useful.
- [Testing and Release Checks](testing.md): local commands, WSL notes, generated
  artifacts, and the release gate.

## Fast Path

For most code changes:

```text
npm run typecheck
npm test
npm run validate
```

Before release packaging:

```text
TMPDIR=/tmp TMP=/tmp TEMP=/tmp npm run check
```
