import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28001
test("source maps should not be served in production mode", async () => {
  using dir = tempDir("issue-28001", {
    "index.html": `<!doctype html>
<title>Source map test</title>
<script type="module" src="script.js"></script>`,
    "script.js": `blah()

function blah () {
  let something = 'yes'
  console.log(something)
}`,
    "server.js": `
import homepage from './index.html'
using server = Bun.serve({
  port: 0,
  routes: { '/': homepage },
  development: false
})

// Wait for bundle to be ready
const resp = await fetch(server.url);
const htmlText = await resp.text();
const jsSrc = htmlText.match(/<script[^>]+src="([^"]+)"/)?.[1];

const jsResp = await fetch(new URL(jsSrc, server.url));
const jsText = await jsResp.text();

const mapUrl = jsSrc.replace(/\\.js$/, ".js.map");
const mapResp = await fetch(new URL(mapUrl, server.url));

console.log(JSON.stringify({
  jsStatus: jsResp.status,
  jsLength: jsText.length,
  hasSourceMappingURL: jsText.includes("sourceMappingURL"),
  sourceMapHeader: jsResp.headers.get("sourcemap"),
  mapStatus: mapResp.status,
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "server.js")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // Verify the JS bundle was actually served
  expect(result.jsStatus).toBe(200);
  expect(result.jsLength).toBeGreaterThan(0);

  // In production mode, the JS should NOT contain a sourceMappingURL
  expect(result.hasSourceMappingURL).toBe(false);

  // The SourceMap header should not be present
  expect(result.sourceMapHeader).toBeNull();

  // Source map file should not be accessible
  expect(result.mapStatus).toBe(404);

  expect(exitCode).toBe(0);
});

test("source maps should still be served in development mode", async () => {
  using dir = tempDir("issue-28001-dev", {
    "index.html": `<!doctype html>
<title>Source map test</title>
<script type="module" src="script.js"></script>`,
    "script.js": `blah()

function blah () {
  let something = 'yes'
  console.log(something)
}`,
    "server.js": `
import homepage from './index.html'
using server = Bun.serve({
  port: 0,
  routes: { '/': homepage },
  development: { hmr: false }
})

// Wait for bundle to be ready
const resp = await fetch(server.url);
const htmlText = await resp.text();
const jsSrc = htmlText.match(/<script[^>]+src="([^"]+)"/)?.[1];

const jsResp = await fetch(new URL(jsSrc, server.url));
const jsText = await jsResp.text();

// Fetch the source map to verify it's actually served
const sourceMapHeader = jsResp.headers.get("sourcemap");
let mapStatus = 0;
let mapHasVersion = false;
if (sourceMapHeader) {
  const mapResp = await fetch(new URL(sourceMapHeader, jsResp.url));
  mapStatus = mapResp.status;
  if (mapResp.ok) {
    const mapJson = await mapResp.json();
    mapHasVersion = mapJson.version === 3;
  }
}

console.log(JSON.stringify({
  jsStatus: jsResp.status,
  jsLength: jsText.length,
  hasSourceMappingURL: jsText.includes("sourceMappingURL"),
  sourceMapHeader,
  mapStatus,
  mapHasVersion,
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "server.js")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  // Verify the JS bundle was actually served
  expect(result.jsStatus).toBe(200);
  expect(result.jsLength).toBeGreaterThan(0);

  // In development mode, the JS SHOULD contain a sourceMappingURL
  expect(result.hasSourceMappingURL).toBe(true);

  // The SourceMap header should be present
  expect(result.sourceMapHeader).not.toBeNull();

  // The source map file should be accessible and valid
  expect(result.mapStatus).toBe(200);
  expect(result.mapHasVersion).toBe(true);

  expect(exitCode).toBe(0);
});
