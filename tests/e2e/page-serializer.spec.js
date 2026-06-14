// @ts-check
import { test, expect, chromium } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const serializerPath = path.join(repoRoot, "extension/export/page-serializer.js");

test("local asset path serialization does not trigger live page asset requests", async () => {
  /** @type {string[]} */
  const requests = [];
  const server = http.createServer((request, response) => {
    const pathName = new URL(request.url || "/", "http://127.0.0.1").pathname;
    requests.push(pathName);
    response.setHeader("cache-control", "no-store, max-age=0");

    if (pathName === "/page.html") {
      response.writeHead(200, {
        "content-type": "text/html;charset=utf-8"
      });
      response.end(`<!doctype html>
        <html>
          <head>
            <title>Serializer Probe</title>
            <link rel="stylesheet" href="/style.css">
          </head>
          <body>
            <img src="/image.png" alt="">
            <iframe src="/frame.html"></iframe>
            <script src="/script.js"></script>
          </body>
        </html>`);
      return;
    }

    if (pathName === "/style.css") {
      response.writeHead(200, {
        "content-type": "text/css;charset=utf-8"
      });
      response.end("body { background-image: url('/background.png'); }");
      return;
    }

    if (pathName === "/script.js") {
      response.writeHead(200, {
        "content-type": "application/javascript;charset=utf-8"
      });
      response.end("window.__tabPackSerializerProbe = true;");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/plain;charset=utf-8"
    });
    response.end("ok");
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The local serializer test server did not return a TCP address.");
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/page.html`, {
      waitUntil: "networkidle"
    });
    await page.waitForTimeout(300);
    requests.length = 0;

    await page.addScriptTag({
      path: serializerPath
    });
    const capturedPage = await page.evaluate(() => {
      return /** @type {any} */ (window).serializeCompleteHtmlInPage({
        assetMode: "relevant",
        assetFolderName: "x_files"
      });
    });
    await page.waitForTimeout(700);

    expect(capturedPage.html).toContain("./x_files/image.png");
    expect(requests.filter((pathName) => pathName !== "/favicon.ico")).toEqual([]);
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
    });
  }
});
