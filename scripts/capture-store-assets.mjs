// @ts-check
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const screenshotsDir = path.join(repoRoot, "docs", "store", "screenshots");
const promoDir = path.join(repoRoot, "docs", "store", "promo-images");
const iconDataUrl = makePngDataUrl(path.join(extensionPath, "assets", "icons", "icon128.png"));

mkdirSync(screenshotsDir, { recursive: true });
mkdirSync(promoDir, { recursive: true });

const fixtureServer = await startFixtureServer();
const userDataDir = path.join(os.tmpdir(), `tabpack-store-assets-${Date.now()}`);

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: {
      width: 1280,
      height: 900
    },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const extensionId = await getExtensionId(context);
    await prepareGroupedTabs(context, extensionId, fixtureServer.baseUrl);
    await closeNonFixturePages(context, fixtureServer.baseUrl);

    await capturePopupScreenshot(context, extensionId);
    const exportPage = await context.newPage();
    await exportPage.goto(`chrome-extension://${extensionId}/export/export.html`);
    await captureExportPreviewScreenshot(exportPage);
    await captureCsvReportScreenshot(exportPage);
    await capturePromoImage(context, 440, 280, path.join(promoDir, "promo-440x280.png"));
    await capturePromoImage(context, 1400, 560, path.join(promoDir, "promo-1400x560.png"));
  } finally {
    await context.close();
  }
} finally {
  await fixtureServer.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log("Captured store screenshots and promotional images.");

async function startFixtureServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const title = getFixtureTitle(pathname);

    response.writeHead(200, {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <style>
            body { color: #17231f; font-family: system-ui, sans-serif; margin: 48px; }
            main { max-width: 720px; }
            h1 { color: #176b52; font-size: 42px; margin-bottom: 12px; }
            p { color: #40534c; font-size: 18px; line-height: 1.5; }
            img { max-width: 240px; }
          </style>
        </head>
        <body>
          <main>
            <h1>${escapeHtml(title)}</h1>
            <p>This local fixture page gives TabPack stable grouped tabs for store screenshots.</p>
            <img src="/asset-${pathname.length}.png" alt="">
          </main>
        </body>
      </html>`);
  });

  await new Promise((resolve) => {
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve(undefined));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The screenshot fixture server did not return a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    }
  };
}

function getFixtureTitle(pathname) {
  if (pathname.includes("research")) {
    return "Research Notes";
  }

  if (pathname.includes("reference")) {
    return "Reference Material";
  }

  if (pathname.includes("planning")) {
    return "Project Planning";
  }

  return "TabPack Fixture";
}

async function getExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  const extensionId = serviceWorker.url().split("/")[2];
  if (!extensionId) {
    throw new Error("Could not resolve the loaded extension ID.");
  }

  return extensionId;
}

async function prepareGroupedTabs(context, extensionId, baseUrl) {
  for (const slug of ["research-notes.html", "reference-material.html", "project-planning.html"]) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${slug}`);
  }

  const setupPage = await context.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/export/export.html`);
  await setupPage.evaluate(async (fixtureBaseUrl) => {
    const extensionChrome = /** @type {any} */ (chrome);
    const tabs = await extensionChrome.tabs.query({ currentWindow: true });
    const tabIds = tabs
      .filter((tab) => tab.url && tab.url.startsWith(fixtureBaseUrl))
      .map((tab) => tab.id)
      .filter((tabId) => typeof tabId === "number");

    if (tabIds.length === 0) {
      throw new Error("No fixture tabs were available for grouping.");
    }

    const groupId = await extensionChrome.tabs.group({ tabIds });
    await extensionChrome.tabGroups.update(groupId, {
      title: "Research"
    });
  }, baseUrl);

  await setupPage.close();
}

async function closeNonFixturePages(context, baseUrl) {
  for (const page of context.pages()) {
    if (!page.url().startsWith(baseUrl)) {
      await page.close();
    }
  }
}

async function capturePopupScreenshot(context, extensionId) {
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 360, height: 280 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForFunction(() => {
    return document.getElementById("eligibleCount")?.textContent !== "-";
  });
  await popupPage.screenshot({
    path: path.join(screenshotsDir, "popup-summary.png"),
    fullPage: true
  });
  await popupPage.close();
}

async function captureExportPreviewScreenshot(exportPage) {
  await exportPage.setViewportSize({ width: 1280, height: 900 });
  await exportPage.waitForFunction(() => {
    const scanButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("scanButton"));
    return scanButton && !scanButton.disabled;
  });
  await exportPage.getByRole("button", { name: "Scan grouped tabs" }).click();
  await exportPage.getByRole("heading", { name: "Research" }).waitFor();
  await exportPage.waitForFunction(() => {
    return document.getElementById("eligibleCount")?.textContent === "3" &&
      document.getElementById("selectedCount")?.textContent === "3";
  });
  await exportPage.screenshot({
    path: path.join(screenshotsDir, "export-preview.png")
  });
}

async function captureCsvReportScreenshot(exportPage) {
  await exportPage.getByLabel("CSV page index (.csv)").check();
  await exportPage.locator("#exportReportCsv").check();
  await exportPage.getByText("CSV rows:").waitFor();
  await exportPage.screenshot({
    path: path.join(screenshotsDir, "csv-report-preview.png")
  });
}

async function capturePromoImage(context, width, height, outputPath) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(makePromoHtml(width, height), {
    waitUntil: "domcontentloaded"
  });
  await page.screenshot({
    path: outputPath,
    clip: {
      x: 0,
      y: 0,
      width,
      height
    }
  });
  await page.close();
}

function makePromoHtml(width, height) {
  const compact = width < 600;
  const titleSize = compact ? 34 : 74;
  const subtitleSize = compact ? 15 : 28;
  const iconSize = compact ? 72 : 150;
  const padding = compact ? 24 : 64;

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          body {
            background: #f7faf8;
            color: #17231f;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            margin: 0;
          }
          main {
            block-size: ${height}px;
            display: grid;
            gap: ${compact ? 18 : 34}px;
            grid-template-columns: ${compact ? "1fr" : "minmax(0, 0.95fr) minmax(360px, 0.75fr)"};
            inline-size: ${width}px;
            overflow: hidden;
            padding: ${padding}px;
          }
          .brand {
            align-content: center;
            display: grid;
            gap: ${compact ? 14 : 24}px;
          }
          .brand-row {
            align-items: center;
            display: flex;
            gap: ${compact ? 14 : 24}px;
          }
          img {
            block-size: ${iconSize}px;
            inline-size: ${iconSize}px;
          }
          h1 {
            font-size: ${titleSize}px;
            letter-spacing: 0;
            line-height: 0.95;
            margin: 0;
          }
          p {
            color: #41554e;
            font-size: ${subtitleSize}px;
            line-height: 1.28;
            margin: 0;
            max-inline-size: ${compact ? 360 : 760}px;
          }
          .chips {
            display: flex;
            flex-wrap: wrap;
            gap: ${compact ? 8 : 12}px;
          }
          .chip {
            background: #e6f2ed;
            border: 1px solid #bdd8cf;
            border-radius: 8px;
            color: #176b52;
            font-size: ${compact ? 12 : 20}px;
            font-weight: 650;
            padding: ${compact ? "7px 9px" : "12px 16px"};
          }
          .mock {
            align-self: center;
            background: #ffffff;
            border: 1px solid #cad8d2;
            border-radius: 8px;
            box-shadow: 0 18px 50px rgb(23 107 82 / 16%);
            display: ${compact ? "none" : "grid"};
            gap: 16px;
            padding: 24px;
          }
          .mock-header {
            align-items: center;
            display: flex;
            justify-content: space-between;
          }
          .mock-title {
            color: #176b52;
            font-size: 22px;
            font-weight: 750;
          }
          .mock-button {
            background: #176b52;
            border-radius: 6px;
            color: #ffffff;
            font-size: 15px;
            font-weight: 700;
            padding: 10px 13px;
          }
          .file {
            border: 1px solid #e0e7e4;
            border-radius: 6px;
            display: grid;
            gap: 4px;
            padding: 12px;
          }
          .file strong {
            color: #17231f;
            font-size: 16px;
          }
          .file span {
            color: #64746f;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 13px;
          }
          footer {
            color: #65746f;
            font-size: ${compact ? 11 : 17}px;
          }
        </style>
      </head>
      <body>
        <main>
          <section class="brand">
            <div class="brand-row">
              <img src="${iconDataUrl}" alt="">
              <h1>TabPack</h1>
            </div>
            <p>Save browser tab groups as local HTML, MHTML, and CSV files.</p>
            <div class="chips">
              <span class="chip">Local-first</span>
              <span class="chip">No telemetry</span>
              <span class="chip">Grouped exports</span>
            </div>
            <footer>github.com/LexC/TabPack</footer>
          </section>
          <section class="mock" aria-hidden="true">
            <div class="mock-header">
              <span class="mock-title">Research</span>
              <span class="mock-button">Export grouped tabs</span>
            </div>
            <div class="file">
              <strong>Research Notes</strong>
              <span>TabPack/Research/1.html</span>
            </div>
            <div class="file">
              <strong>Reference Material</strong>
              <span>TabPack/Research/2.html</span>
            </div>
            <div class="file">
              <strong>Project Planning</strong>
              <span>TabPack/Research/3.html</span>
            </div>
          </section>
        </main>
      </body>
    </html>`;
}

function makePngDataUrl(filePath) {
  const data = readFileSync(filePath).toString("base64");
  return `data:image/png;base64,${data}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
