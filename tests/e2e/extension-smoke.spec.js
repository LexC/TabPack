// @ts-check
import { test, expect, chromium } from "@playwright/test";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const extensionPath = path.join(repoRoot, "extension");

let server;
let baseUrl;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const pathName = new URL(request.url, "http://127.0.0.1").pathname;
    response.writeHead(200, {
      "content-type": "text/html;charset=utf-8"
    });
    response.end(`<!doctype html><title>${pathName}</title><h1>${pathName}</h1>`);
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The local e2e server did not return a TCP address.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test("loads extension, summarizes popup, scans, selects, and previews CSV rows", async () => {
  const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), `tabpack-e2e-${Date.now()}`), {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }
    const extensionId = serviceWorker.url().split("/")[2];

    const firstPage = await context.newPage();
    await firstPage.goto(`${baseUrl}/one.html`);
    const secondPage = await context.newPage();
    await secondPage.goto(`${baseUrl}/two.html`);

    const exportPage = await context.newPage();
    await exportPage.goto(`chrome-extension://${extensionId}/export/export.html`);
    await expect(exportPage.getByRole("link", { name: "Source code" })).toHaveAttribute("href", "https://github.com/LexC/TabPack");

    await exportPage.evaluate(async (base) => {
      const extensionChrome = /** @type {any} */ (chrome);
      const tabs = await extensionChrome.tabs.query({ currentWindow: true });
      const tabIds = tabs
        .filter((tab) => tab.url && tab.url.startsWith(base))
        .map((tab) => tab.id);
      const groupId = await extensionChrome.tabs.group({ tabIds });
      await extensionChrome.tabGroups.update(groupId, { title: "E2E Group" });
    }, baseUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(popupPage.locator("#groupCount")).toHaveText("1");
    await expect(popupPage.locator("#eligibleCount")).toHaveText("2");

    await exportPage.getByRole("button", { name: "Scan grouped tabs" }).click();
    await expect(exportPage.getByRole("heading", { name: "E2E Group" })).toBeVisible();
    await expect(exportPage.getByText("Group: E2E Group")).toHaveCount(0);
    await expect(exportPage.getByText("E2E Group -> E2E Group")).toHaveCount(0);
    await expect(exportPage.locator("#eligibleCount")).toHaveText("2");
    await expect(exportPage.locator("#selectedCount")).toHaveText("2");

    await exportPage.locator(".tab-select input[type='checkbox']").first().uncheck();
    await expect(exportPage.locator("#selectedCount")).toHaveText("1");
    const deselectedPreview = exportPage.locator(".tab-preview-body").first();
    await expect(deselectedPreview.getByText("Status:")).toBeVisible();
    await expect(deselectedPreview.getByText("Not selected")).toBeVisible();
    const selectedPreview = exportPage.locator(".tab-preview-body").nth(1);
    await expect(selectedPreview.getByText("Title:")).toBeVisible();
    await expect(selectedPreview.getByText("File:")).toBeVisible();
    await expect(selectedPreview.getByText("TabPack/E2E Group/1.html")).toBeVisible();
    const selectedPreviewText = await selectedPreview.textContent();
    expect(selectedPreviewText.indexOf("Title:")).toBeLessThan(selectedPreviewText.indexOf("File:"));
    await expect(exportPage.getByRole("group", { name: "Filename mode" })).toBeVisible();
    await expect(exportPage.getByRole("group", { name: "Filename conflict behavior" })).toBeVisible();
    await expect(exportPage.getByLabel("Keep original scan numbers")).not.toBeChecked();
    await expect(exportPage.getByLabel("Close tabs after successful export")).not.toBeChecked();
    await expect(exportPage.getByRole("button", { name: "Retry failed tabs" })).toBeDisabled();
    await expect(exportPage.locator("#exportReportCsv")).not.toBeChecked();
    await expect(exportPage.getByRole("heading", { name: "Report CSV" })).toBeVisible();
    const reportPreview = exportPage.locator(".group-preview", {
      has: exportPage.getByRole("heading", { name: "Report CSV" })
    });
    await expect(reportPreview.getByText("Status:")).toBeVisible();
    await expect(reportPreview.getByText("Not exported")).toBeVisible();

    await exportPage.getByLabel("Keep original scan numbers").check();
    await expect(selectedPreview.getByText("TabPack/E2E Group/2.html")).toBeVisible();

    await exportPage.getByRole("button", { name: "Page title filenames" }).click();
    await expect(selectedPreview.getByText("TabPack/E2E Group/_two.html.html")).toBeVisible();

    await exportPage.getByLabel("CSV page index (.csv)").check();
    await expect(reportPreview.getByText("CSV mode:")).toBeVisible();
    await expect(reportPreview.getByText("Enable Export report CSV before exporting")).toBeVisible();
    await expect(selectedPreview.getByText("CSV row:")).toBeVisible();
    await expect(selectedPreview.getByText("Not exported")).toBeVisible();

    await exportPage.locator("#exportReportCsv").check();
    await expect(reportPreview.getByText("CSV file:")).toBeVisible();
    await expect(reportPreview.getByText("tab-groups.csv")).toBeVisible();
    await expect(selectedPreview.getByText("Included")).toBeVisible();
    await expect(exportPage.getByText("selected_for_export=false")).toHaveCount(0);
    await expect(exportPage.getByText("selected_for_export=true")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
