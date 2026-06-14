import assert from "node:assert/strict";
import { test } from "node:test";

await import(new URL("../../extension/shared/constants.js", import.meta.url).href);
await import(new URL("../../extension/shared/export-helpers.js", import.meta.url).href);

const helpers = globalThis.TabPackExportHelpers;
const constants = globalThis.TabPackConstants;

function sampleTabs() {
  return [
    { id: 1, groupId: 10, index: 0, title: "Alpha", url: "https://example.com/a" },
    { id: 2, groupId: 10, index: 1, title: "Beta", url: "https://example.com/b" },
    { id: 3, groupId: -1, index: 2, title: "Loose", url: "https://example.com/loose" },
    { id: 4, groupId: 11, index: 3, title: "Gamma", url: "https://example.org/g" },
    { id: 5, groupId: 11, index: 4, title: "Settings", url: "chrome://settings" }
  ];
}

function sampleGroups() {
  return new Map([
    [10, { id: 10, title: "Research" }],
    [11, { id: 11, title: "Research" }]
  ]);
}

test("builds a default all-selected plan with unique folders", () => {
  const plan = helpers.buildExportPlanFromTabs(sampleTabs(), sampleGroups(), {
    noGroupId: -1,
    mode: constants.HTML_RELEVANT_ASSETS_MODE,
    createRootFolder: true,
    downloadsFallback: false
  });

  assert.equal(plan.totalEligibleTabs, 3);
  assert.equal(plan.totalSelectedTabs, 3);
  assert.equal(plan.skippedTabs.length, 2);
  assert.equal(plan.groups[0].sanitizedFolderName, "Research");
  assert.equal(plan.groups[1].sanitizedFolderName, "Research__group_11");
  assert.equal(plan.groups[0].files[0].fileName, "1.html");
  assert.equal(plan.groups[0].files[1].fileName, "2.html");
  assert.equal(plan.groups[0].files[0].plannedAssetFolderPath, "TabPack/Research/1_files/");
});

test("deselected tabs are compactly renumbered within each group", () => {
  const selectedKeys = new Set([
    helpers.makeSelectionKey(10, 2),
    helpers.makeSelectionKey(11, 4)
  ]);
  const plan = helpers.buildExportPlanFromTabs(sampleTabs(), sampleGroups(), {
    noGroupId: -1,
    mode: constants.MHTML_MODE,
    createRootFolder: false,
    selectedKeys
  });

  assert.equal(plan.totalSelectedTabs, 2);
  assert.equal(plan.totalDeselectedTabs, 1);
  assert.equal(plan.groups[0].files[0].selected, false);
  assert.equal(plan.groups[0].files[0].fileName, "");
  assert.equal(plan.groups[0].files[1].selectedOrderInGroup, 1);
  assert.equal(plan.groups[0].files[1].fileName, "1.mhtml");
  assert.equal(plan.groups[0].files[1].plannedRelativePath, "Research/1.mhtml");
});

test("CSV index includes only selected rows in a readable order", () => {
  const selectedKeys = new Set([helpers.makeSelectionKey(10, 2)]);
  const plan = helpers.buildExportPlanFromTabs(sampleTabs(), sampleGroups(), {
    noGroupId: -1,
    mode: constants.MHTML_MODE,
    selectedKeys
  });
  const csv = helpers.generateCsvIndex(plan, {
    exportedAt: "2026-06-14T00:00:00.000Z",
    pageResults: [
      {
        selectionKey: helpers.makeSelectionKey(10, 2),
        finalRelativePath: "TabPack/Research/1.mhtml"
      }
    ]
  });
  const lines = csv.trim().split("\r\n");

  assert.equal(lines.length, 2);
  assert.equal(lines[0], "\"exported_at\",\"export_mode\",\"group_order\",\"group_name\",\"group_id\",\"selected_order_in_group\",\"tab_order_in_group\",\"tab_index\",\"tab_id\",\"page_title\",\"page_url\",\"file_path\",\"asset_folder_path\"");
  assert.match(lines[1], /"2026-06-14T00:00:00.000Z","mhtml","1","Research","10","1","2","1","2","Beta","https:\/\/example.com\/b","TabPack\/Research\/1.mhtml",""/);
  assert.doesNotMatch(csv, /selected_for_export|skip_reason|group_folder|deselected|ungrouped|unsupported URL/);
  assert.equal(helpers.getSelectedCsvRowCount(plan), 1);
});

test("export report includes selected, deselected, skipped, and generated file details", () => {
  const selectedKeys = new Set([helpers.makeSelectionKey(10, 2)]);
  const plan = helpers.buildExportPlanFromTabs(sampleTabs(), sampleGroups(), {
    noGroupId: -1,
    mode: constants.MHTML_MODE,
    selectedKeys
  });
  const report = helpers.generateExportReport(plan, {
    exportedAt: "2026-06-14T00:00:00.000Z",
    extensionVersion: "1.1.0",
    destination: {
      type: "selected-folder",
      label: "selected folder/TabPack/",
      rootFolderCreated: true,
      conflictBehavior: "uniquify",
      reportRelativePath: "TabPack/tabpack-export-report.json"
    },
    pageResults: [
      {
        selectionKey: helpers.makeSelectionKey(10, 2),
        status: "saved",
        finalRelativePath: "TabPack/Research/1.mhtml"
      }
    ],
    generatedFiles: [
      {
        kind: "csv_index",
        status: "saved",
        finalRelativePath: "TabPack/tab-groups.csv",
        rowCount: 1
      }
    ],
    successCount: 2,
    failureCount: 0,
    assetWarnings: 0
  });

  assert.equal(report.application.name, "TabPack");
  assert.equal(report.application.version, "1.1.0");
  assert.equal(report.totals.selectedTabs, 1);
  assert.equal(report.totals.deselectedTabs, 2);
  assert.equal(report.totals.skippedTabs, 2);
  assert.equal(report.selectedPages.length, 1);
  assert.equal(report.selectedPages[0].result.status, "saved");
  assert.equal(report.deselectedPages.length, 2);
  assert.equal(report.skippedTabs.length, 2);
  assert.equal(report.generatedFiles[0].kind, "csv_index");
});

test("sanitizes reserved and invalid folder names", () => {
  assert.equal(helpers.sanitizeFolderName("CON", 1), "CON_group");
  assert.equal(helpers.sanitizeFolderName(" Bad<Name>... ", 1), "Bad_Name_");
  assert.equal(helpers.sanitizeFolderName("", 44), "Group_44");
});

test("summarizes popup tab counts", () => {
  const summary = helpers.summarizeTabs(sampleTabs(), {
    noGroupId: -1
  });

  assert.equal(summary.groupCount, 2);
  assert.equal(summary.eligibleGroupedTabs, 3);
  assert.equal(summary.unsupportedGroupedTabs, 1);
  assert.equal(summary.ungroupedTabs, 1);
  assert.equal(summary.skippedTabs, 2);
});

test("host access is only required for HTML serialization modes", () => {
  assert.equal(helpers.modeRequiresHostAccess(constants.HTML_PAGE_MODE), true);
  assert.equal(helpers.modeRequiresHostAccess(constants.HTML_RELEVANT_ASSETS_MODE), true);
  assert.equal(helpers.modeRequiresHostAccess(constants.MHTML_MODE), false);
  assert.equal(helpers.modeRequiresHostAccess(constants.CSV_MODE), false);
  assert.deepEqual(helpers.getOptionalHostOrigins(), ["http://*/*", "https://*/*"]);
});
