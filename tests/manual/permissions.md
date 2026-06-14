# Optional Runtime Permissions

## HTML Permission Grant

- [ ] Reload the unpacked extension after installing the v1.1 manifest.
- [ ] Select an HTML export mode.
- [ ] Scan grouped HTTP/HTTPS tabs and choose an output destination.
- [ ] Click Export grouped tabs.
- [ ] Confirm the browser prompts for HTTP/HTTPS page access if it has not already been granted.
- [ ] Grant access and confirm export continues.

## HTML Permission Denial

- [ ] Revoke site access from the extension details page.
- [ ] Start an HTML export again.
- [ ] Deny the runtime permission prompt.
- [ ] Confirm export stops with a clear error and no new page export starts.

## Non-HTML Modes

- [ ] Select CSV page index and export.
- [ ] Confirm no HTTP/HTTPS host access prompt appears.
- [ ] Select MHTML page archives and export.
- [ ] Confirm no HTTP/HTTPS host access prompt appears.
- [ ] Confirm the browser prompts for MHTML capture permission if `pageCapture` has not already been granted.

## Downloads Fallback Permission

- [ ] Revoke the Downloads permission from the extension details page, if it was previously granted.
- [ ] Force or select the `Downloads/TabPack/` fallback.
- [ ] Export any selected mode.
- [ ] Confirm the browser prompts for Downloads permission before files are queued.
- [ ] Deny the prompt and confirm export stops with a clear error.

## Notes

```text

```
