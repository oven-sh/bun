/// This file acts as a basic headless browser.
let url = process.argv[2];
if (!url) {
  console.error(`Usage: ${process.argv[1]} <url>`);
  process.exit(1);
}
url = new URL(url);

import { Browser, BrowserErrorCaptureEnum } from "happy-dom";

const browser = new Browser({ settings: { errorCapture: BrowserErrorCaptureEnum.processLevel } });
const page = browser.newPage();

await page.goto(url.href);
await page.waitUntilComplete();
