# TabPack Privacy Policy

TabPack is designed as a local-only browser extension.

## Data Collection

TabPack does not collect, transmit, sell, rent, or share personal data.

The extension does not use analytics, telemetry, tracking pixels, remote logging, advertising SDKs, or external application servers.

## Local Browser Access

TabPack reads tab metadata when you open the popup or scan grouped tabs. It reads page content only when you explicitly export selected grouped tabs in an HTML mode. This access is used to create files on your device.

The extension can read:

- URLs and titles of tabs in the current browser window.
- Microsoft Edge or Chromium tab group metadata.
- Page HTML and referenced page assets for supported export modes.
- Export preferences stored locally by the browser, such as mode and conflict behavior.

## File Exports

Exports are written to the folder you choose with the File System Access API, or to the clearly labeled Downloads fallback when selected-folder export is unavailable.

When the browser allows it, TabPack stores a local folder handle so the same output folder can be restored later. If the browser no longer grants write permission, TabPack asks you to choose the folder again.

TabPack does not upload exported files anywhere.

## Network Requests

HTML asset export modes may fetch assets that are already referenced by the open page so they can be saved into local `_files` folders. The extension does not refetch the page URL itself for export.

HTTP/HTTPS host access is requested at runtime for HTML export modes. CSV and MHTML exports do not need that optional host access.

## Contact

For privacy questions, use the support contact listed on the store listing or project repository.
