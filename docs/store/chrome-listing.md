# Chrome Web Store Listing Draft

## Name

TabPack

## Short Description

Save Tab Groups as Local Files

## Description

TabPack saves grouped tabs from the current browser window into local files on your device. Each tab group becomes a folder, and supported HTTP or HTTPS tabs are selected by default in the same left-to-right order shown in the tab strip. You can deselect groups or tabs before export.

Supported export modes include HTML snapshots, HTML plus local asset folders, MHTML archives, and selected-page CSV indexes. An optional CSV report can be written alongside page exports, and filenames can use either compact numbering or sanitized page titles.

TabPack is local-only. It does not upload files, use analytics, require login, or send telemetry.

## Suggested Categories

Productivity, Developer Tools, Workflow and Planning

## Privacy Notes

TabPack needs tab, tab group, scripting, and storage permissions to inspect grouped tabs, serialize open pages, and remember settings. MHTML capture, Downloads fallback, and HTTP/HTTPS host access are requested at runtime only when the selected export mode needs them.

Exports stay on the user's device.
