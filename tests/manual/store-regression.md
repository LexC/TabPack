# Store Regression

## Documentation

- [ ] Confirm README permissions describe optional HTTP/HTTPS host access.
- [ ] Confirm PRIVACY.md still says exports stay local and mentions asset fetches only for referenced assets.
- [ ] Confirm Edge and Chrome listing drafts mention runtime page access.
- [ ] Confirm CHANGELOG.md includes the v1.1 changes.

## Packaging

- [ ] Confirm `extension/manifest.json` has `optional_host_permissions`, not broad HTTP/HTTPS `host_permissions`.
- [ ] Confirm `pageCapture` and `downloads` are optional permissions, while `scripting` remains required.
- [ ] Confirm `storage` is included in permissions.
- [ ] Confirm no remote scripts, inline scripts, or inline styles were added.
- [ ] Confirm icons are present and PNG signatures validate.

## Repository Review

- [ ] Confirm unrelated pre-existing changes, especially `LICENSE`, were not edited for this release.
- [ ] Confirm `tests/` contains manual, unit, and e2e coverage.
- [ ] Confirm CI runs tests, validation, and build.

## Notes

```text

```
