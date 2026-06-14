# Export Modes

## HTML Online Assets

- [ ] Select HTML page, online assets.
- [ ] Export selected grouped tabs to a custom folder.
- [ ] Confirm each selected tab writes only `N.html`.
- [ ] Confirm deselected tabs do not write files.

## HTML Relevant Assets

- [ ] Select HTML page + relevant assets.
- [ ] Export pages with scripts, stylesheets, images, and icons.
- [ ] Confirm selected tabs write `N.html` plus matching `N_files/`.
- [ ] Confirm stylesheet-internal `url(...)` and `@import` references may remain online URLs.

## HTML All Assets

- [ ] Select HTML page + all assets.
- [ ] Export the same complex page used for relevant assets.
- [ ] Confirm the `_files/` folder may contain additional recursively fetched stylesheet assets.

## MHTML

- [ ] Select MHTML page archives.
- [ ] Export a simple public webpage.
- [ ] Open the `.mhtml` file in Edge.
- [ ] Retry with a complex page and confirm capture failures increment Failed while later tabs continue.

## CSV Audit

- [ ] Select CSV page index.
- [ ] Deselect at least one eligible tab.
- [ ] Export `tab-groups.csv`.
- [ ] Confirm rows include `selected`, `deselected`, and `skipped` statuses.
- [ ] Confirm the header exactly matches the README CSV column list.

## Notes

```text

```
