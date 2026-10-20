// The control for the harness: runs the same tests in Chromium, Firefox and WebKit, and prints the same JSON lines,
// each with a `browser`. Runs under Node in the Playwright image. There is no server: every request is answered from disk.
//
//   node run-in-browsers.js <playwright-core directory> <wpt directory> [--jobs=<number>] [--browsers=a,b] <directory or test>...
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { findFile, listTests, markupForScriptTest, scriptPathForGeneratedPage, substituteServerVariables, testOrigin } from "./test-files.js";

const flags = process.argv.slice(2).filter(argument => argument.startsWith("--"));
const [playwrightDirectory, wptDirectory, ...targets] = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const flagValue = (name, fallback) => flags.find(flag => flag.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const jobs = Number(flagValue("jobs", 8));
const browserNames = flagValue("browsers", "chromium,firefox,webkit").split(",");
const playwright = createRequire(import.meta.url)(playwrightDirectory);

const tests = targets.flatMap(target =>
  /\.html?(?:\?.*)?$/.test(target)
    ? [{ path: "/" + target.replace(/^\/+/, ""), kind: "testharness" }]
    : listTests(wptDirectory, target.replace(/^\/+/, "")),
);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".png": "image/png",
  ".txt": "text/plain",
};

const reportScript = `
setup({ output: false });
add_completion_callback((tests, status) => {
  const subtestStatuses = ["PASS", "FAIL", "TIMEOUT", "NOTRUN", "PRECONDITION_FAILED"];
  const harnessStatuses = ["OK", "ERROR", "TIMEOUT", "PRECONDITION_FAILED"];
  if (window.reportResults) reportResults({
    status: harnessStatuses[status.status],
    message: status.message ?? null,
    subtests: tests.map(test => ({ name: test.name, status: subtestStatuses[test.status], message: test.message ?? null })),
  });
});
`;

function respond(route) {
  const url = new URL(route.request().url());
  if (url.pathname === "/resources/testharnessreport.js") return route.fulfill({ contentType: contentTypes[".js"], body: reportScript });
  const scriptPath = scriptPathForGeneratedPage(url.pathname);
  const file = findFile(wptDirectory, scriptPath ?? url.pathname);
  if (file === null) return route.fulfill({ status: 404, body: "" });
  if (scriptPath) return route.fulfill({ contentType: contentTypes[".html"], body: markupForScriptTest(scriptPath, readFileSync(file, "utf8")) });
  const contentType = contentTypes[extname(file)] ?? "application/octet-stream";
  if (/\.sub\./.test(url.pathname)) return route.fulfill({ contentType, body: substituteServerVariables(readFileSync(file, "utf8"), url) });
  return route.fulfill({ contentType, body: readFileSync(file) });
}

async function run(browser, test) {
  if (test.kind === "skipped") return { test: test.path, status: "SKIPPED", message: test.reason, subtests: [] };
  const context = await browser.newContext();
  let timer;
  try {
    await context.route("**/*", respond);
    const page = await context.newPage();
    const { promise: outcome, resolve } = Promise.withResolvers();
    await page.exposeFunction("reportResults", resolve);
    page.on("crash", () => resolve({ status: "CRASH", message: null, subtests: [] }));
    timer = setTimeout(resolve, 75_000, { status: "HANG", message: null, subtests: [] });
    await page.goto(testOrigin(test.path) + test.path);
    if (test.kind === "crashtest") return { test: test.path, kind: test.kind, status: "OK", message: "no testharness.js", subtests: [] };
    return { test: test.path, kind: test.kind, ...(await outcome) };
  } catch (error) {
    return { test: test.path, kind: test.kind, status: "HARNESS_ERROR", message: String(error), subtests: [] };
  } finally {
    clearTimeout(timer);
    await context.close();
  }
}

for (const name of browserNames) {
  const browser = await playwright[name].launch();
  const label = `${name} ${browser.version()}`;
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < tests.length) console.log(JSON.stringify({ browser: label, ...(await run(browser, tests[next++])) }));
    }),
  );
  await browser.close();
}
