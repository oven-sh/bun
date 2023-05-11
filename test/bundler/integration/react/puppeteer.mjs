import * as p from "puppeteer";
import * as http from "http";
import * as fs from "fs";
import * as assert from "assert";

const distDir = process.argv[2];
if (!distDir) {
  throw new Error(".");
}

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream("./index.html").pipe(res);
  } else if (req.url === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/x-icon" });
    fs.createReadStream("../favicon.ico").pipe(res);
  } else if (!req.url.includes("..") && fs.existsSync(distDir + req.url)) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    fs.createReadStream(distDir + req.url).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(3000, "127.0.0.1");

//

const browser = await p.launch({
  headless: "new",
});

let logs = [];
let domSnapshots = [];

const page = await browser.newPage();
page.on("console", msg => logs.push(msg.text()));

await page.goto("http://localhost:3000");
try {
  await page.waitForFunction(() => window.__TEST__, { timeout: 1000 });
} catch (error) {
  console.error("Page did not initialize");
  console.error(logs);
  await browser.close();
  server.close();
  process.exit(1);
}
assert.strictEqual(await page.evaluate(() => document.body.querySelector(".count").innerText), "Count: 0");
domSnapshots.push(await page.evaluate(() => document.body.parentElement.outerHTML));

logs.push("-- testing marker --");

await page.click("button");
await new Promise(resolve => setTimeout(resolve, 50));
assert.strictEqual(await page.evaluate(() => document.body.querySelector(".count").innerText), "Count: 1");
domSnapshots.push(await page.evaluate(() => document.body.parentElement.outerHTML));

logs.push("-- testing marker --");

await page.click("button");
await new Promise(resolve => setTimeout(resolve, 50));
assert.strictEqual(await page.evaluate(() => document.body.querySelector(".count").innerText), "Count: 2");
domSnapshots.push(await page.evaluate(() => document.body.parentElement.outerHTML));

console.log(JSON.stringify({ logs, domSnapshots }));
await browser.close();
server.close();
