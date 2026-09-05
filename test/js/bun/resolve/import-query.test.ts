import { beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";
globalThis.importQueryFixtureOrder = [];
const resolvedPath = require.resolve("./import-query-fixture.ts");
const resolvedURL = Bun.pathToFileURL(resolvedPath).href;

beforeEach(() => {
  globalThis.importQueryFixtureOrder = [];
  delete require.cache[resolvedPath];
  delete require.cache[resolvedPath + "?query"];
  delete require.cache[resolvedPath + "?query2"];
});

test("[query, no query]", async () => {
  const second = await import("./import-query-fixture.ts?query");
  const first = await import("./import-query-fixture.ts");
  expect(second.url).toBe(first.url + "?query");
  expect(globalThis.importQueryFixtureOrder).toEqual([resolvedURL + "?query", resolvedURL]);
});

test("[no query, query]", async () => {
  const first = await import("./import-query-fixture.ts");
  const second = await import("./import-query-fixture.ts?query");
  expect(second.url).toBe(first.url + "?query");
  expect(globalThis.importQueryFixtureOrder).toEqual([resolvedURL, resolvedURL + "?query"]);
});

for (let order of [
  [resolvedPath, resolvedPath + "?query", resolvedPath + "?query2"],
  [resolvedPath + "?query", resolvedPath + "?query2", resolvedPath],
  [resolvedPath + "?query", resolvedPath, resolvedPath + "?query2"],
  [resolvedPath, resolvedPath + "?query2", resolvedPath + "?query"],
  [resolvedPath + "?query2", resolvedPath, resolvedPath + "?query"],
  [resolvedPath + "?query2", resolvedPath + "?query", resolvedPath],
]) {
  test(`[${order.map(url => url.replaceAll(import.meta.dir, "")).join(", ")}]`, async () => {
    for (const url of order) {
      await import(url);
    }

    expect(globalThis.importQueryFixtureOrder).toEqual(
      order.map(url => resolvedURL + (url.includes("?") ? "?" + url.split("?")[1] : "")),
    );
  });
}

// When the specifier contains non-ASCII characters (so toUTF8() must allocate a
// fresh buffer on the Zig side), the query string returned to C++ must not point
// into that freed buffer. With ASAN this is a heap-use-after-free; without it the
// resolved key comes back corrupted.
test("query string with non-ASCII specifier (dynamic import)", async () => {
  using dir = tempDir("import-query-nonascii", {
    "target.js": `console.log(JSON.stringify(import.meta.url));`,
    "entry.js": `await import("./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const url = JSON.parse(stdout.trim());
  expect(decodeURIComponent(url)).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});

test("query string with non-ASCII specifier (static import)", async () => {
  using dir = tempDir("import-query-nonascii-static", {
    "target.js": `console.log(JSON.stringify(import.meta.url));`,
    "entry.js": `import "./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e";`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const url = JSON.parse(stdout.trim());
  expect(decodeURIComponent(url)).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});

// A `.node` (Node-API addon) specifier must behave the same with and without a
// `?query` suffix. Query-suffixed spellings used to bypass the `.node` checks
// (which run before the query is stripped) and abort the process with
// `panic: entered unreachable code: napi modules go through provideFetch()`.
const NAPI_IMPORT_ERROR = "To load Node-API modules, use require() or process.dlopen instead of import.";

test("dynamic import of a .node addon ignores a query string suffix", async () => {
  using dir = tempDir("import-query-napi-dynamic", {
    "addon.node": "",
    "entry.mjs": `
      const out = [];
      for (const spec of ["./addon.node", "./addon.node?v=1", "./addon.node?v=2"]) {
        try {
          await import(spec);
          out.push(null);
        } catch (e) {
          out.push(e.constructor.name + ": " + e.message);
        }
      }
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify([
      `TypeError: ${NAPI_IMPORT_ERROR}`,
      `TypeError: ${NAPI_IMPORT_ERROR}`,
      `TypeError: ${NAPI_IMPORT_ERROR}`,
    ]),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test("static import of a .node addon ignores a query string suffix", async () => {
  using dir = tempDir("import-query-napi-static", {
    "addon.node": "",
    "entry.mjs": `import "./addon.node?update=1";`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    firstLine: normalizeBunSnapshot(stderr, String(dir)).split("\n")[0],
    stdout,
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
    firstLine: `TypeError: ${NAPI_IMPORT_ERROR}`,
    stdout: "",
    exitCode: 1,
    signalCode: null,
  });
});

test("require of a .node addon with a query string reaches process.dlopen", async () => {
  using dir = tempDir("import-query-napi-require", {
    "addon.node": "",
    "entry.cjs": `
      const out = [];
      for (const spec of ["./addon.node", "./addon.node?v=1", "./addon.node?v=2"]) {
        try {
          require(spec);
          out.push(null);
        } catch (e) {
          out.push(e.constructor.name + ": " + e.message);
        }
      }
      console.log(JSON.stringify(out));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({ stderr: "", exitCode: 0, signalCode: null });
  const [plain, withQuery, withOtherQuery] = JSON.parse(stdout.trim());
  // An empty `.node` file cannot be dlopen'd. The query-suffixed spellings must
  // fail with the identical dlopen error (proving the on-disk path was
  // stripped of the query), not the ESM "use require()" TypeError.
  expect(plain).not.toContain("Node-API");
  expect(withQuery).toBe(plain);
  expect(withOtherQuery).toBe(plain);
});

test("import of an extension mapped to the napi loader throws instead of crashing", async () => {
  using dir = tempDir("import-query-napi-loader-flag", {
    "thing.xyz": "",
    "entry.mjs": `
      try {
        await import("./thing.xyz");
        console.log(JSON.stringify(null));
      } catch (e) {
        console.log(JSON.stringify(e.constructor.name + ": " + e.message));
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--loader=.xyz:napi", "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify(`TypeError: ${NAPI_IMPORT_ERROR}`),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// #13391, #21346: a file:// URL specifier with a ?query must produce a distinct
// module instance per distinct query, the same as a relative or absolute path
// specifier does. Tools such as `astro dev` rely on
// `await import(pathToFileURL(p) + "?t=" + Date.now())` to re-read a config
// file after it changes on disk.
test.concurrent("dynamic import of a file:// URL keeps the query string in the module key", async () => {
  using dir = tempDir("import-query-file-url-dynamic", {
    "config.mjs": `export default { port: 4321 };\nexport const url = import.meta.url;`,
    "entry.mjs": `
      import { pathToFileURL } from "node:url";
      import { writeFileSync } from "node:fs";
      const base = pathToFileURL("./config.mjs").href;
      const m1 = await import(base + "?t=1");
      writeFileSync("./config.mjs", "export default { port: 2000 };\\nexport const url = import.meta.url;");
      const m2 = await import(base + "?t=2");
      const m2Again = await import(base + "?t=2");
      console.log(JSON.stringify({
        first: m1.default.port,
        second: m2.default.port,
        sameForDifferentQuery: m1 === m2,
        sameForSameQuery: m2 === m2Again,
        url1: m1.url.slice(m1.url.lastIndexOf("/") + 1),
        url2: m2.url.slice(m2.url.lastIndexOf("/") + 1),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    first: 4321,
    second: 2000,
    sameForDifferentQuery: false,
    sameForSameQuery: true,
    url1: "config.mjs?t=1",
    url2: "config.mjs?t=2",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("mock.module with a file:// URL + query string registers under the key import() uses", async () => {
  using dir = tempDir("import-query-file-url-mock", {
    "real.mjs": `export default "REAL"; export const url = import.meta.url;`,
    "entry.mjs": `
      import { mock } from "bun:test";
      import { pathToFileURL } from "node:url";
      const base = pathToFileURL("./real.mjs").href;
      mock.module(base + "?v=1", () => ({ default: "MOCKED", url: "mocked" }));
      const m1 = await import(base + "?v=1");
      const m2 = await import(base + "?v=2");
      // Relative specifier for a file that does not exist on disk: registration
      // and virtual-module lookup both go through the relative-URL fallback.
      mock.module("./virt.mjs?v=1", () => ({ default: "VMOCK" }));
      const m3 = await import("./virt.mjs?v=1");
      console.log(JSON.stringify({
        mocked: m1.default,
        unmocked: m2.default,
        unmockedUrl: m2.url.slice(m2.url.lastIndexOf("/") + 1),
        relMocked: m3.default,
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    mocked: "MOCKED",
    unmocked: "REAL",
    unmockedUrl: "real.mjs?v=2",
    relMocked: "VMOCK",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.resolveSync and Bun.resolve of a file:// URL keep the query string", async () => {
  using dir = tempDir("import-query-file-url-resolvesync", {
    "target.mjs": ``,
    "entry.mjs": `
      import { pathToFileURL } from "node:url";
      const base = pathToFileURL("./target.mjs").href;
      const noQuery = Bun.resolveSync(base, import.meta.dir);
      console.log(JSON.stringify({
        noQuery,
        withQuery: Bun.resolveSync(base + "?t=1", import.meta.dir),
        withOtherQuery: Bun.resolveSync(base + "?t=2", import.meta.dir),
        relative: Bun.resolveSync("./target.mjs?t=1", import.meta.dir),
        async: await Bun.resolve(base + "?t=1", import.meta.dir),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { noQuery, ...resolved } = JSON.parse(stdout.trim());
  expect(noQuery).toEndWith(path.sep + "target.mjs");
  expect(resolved).toEqual({
    withQuery: noQuery + "?t=1",
    withOtherQuery: noQuery + "?t=2",
    relative: noQuery + "?t=1",
    async: noQuery + "?t=1",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("import.meta.resolveSync and import.meta.resolve of a file:// URL keep the query string", async () => {
  using dir = tempDir("import-query-file-url-import-meta-resolve", {
    "target.js": ``,
    "entry.mjs": `
      const base = new URL("./target.js", import.meta.url).href;
      const noQuery = import.meta.resolveSync(base);
      console.log(JSON.stringify({
        noQuery,
        withQuery: import.meta.resolveSync(base + "?v=1"),
        relative: import.meta.resolveSync("./target.js?v=2"),
        url: import.meta.resolve(base + "?v=1"),
        relativeUrl: import.meta.resolve("./target.js?v=2"),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { noQuery, ...resolved } = JSON.parse(stdout.trim());
  expect(noQuery).toEndWith(path.sep + "target.js");
  expect(resolved).toEqual({
    withQuery: noQuery + "?v=1",
    relative: noQuery + "?v=2",
    url: Bun.pathToFileURL(noQuery).href + "?v=1",
    relativeUrl: Bun.pathToFileURL(noQuery).href + "?v=2",
  });
  expect(exitCode).toBe(0);
});

// require() already evaluates "./x.cjs?v=1" and "./x.cjs?v=2" as two modules;
// a file:// URL spelling of the same specifier goes through the same resolver.
test.concurrent("require and require.resolve of a file:// URL keep the query string", async () => {
  using dir = tempDir("import-query-file-url-require", {
    "target.cjs": `module.exports = {};`,
    "entry.cjs": `
      const { pathToFileURL } = require("node:url");
      const base = pathToFileURL(require("node:path").join(__dirname, "target.cjs")).href;
      const noQuery = require.resolve(base);
      const v1 = require(base + "?v=1");
      const v2 = require(base + "?v=2");
      console.log(JSON.stringify({
        noQuery,
        resolvedWithQuery: require.resolve(base + "?v=1"),
        resolvedRelative: require.resolve("./target.cjs?v=1"),
        sameForDifferentQuery: v1 === v2,
        sameForSameQuery: v1 === require(base + "?v=1"),
        sameAsRelative: v1 === require("./target.cjs?v=1"),
        sameAsNoQuery: v1 === require(base),
      }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { noQuery, ...result } = JSON.parse(stdout.trim());
  expect(noQuery).toEndWith(path.sep + "target.cjs");
  expect(result).toEqual({
    resolvedWithQuery: noQuery + "?v=1",
    resolvedRelative: noQuery + "?v=1",
    sameForDifferentQuery: false,
    sameForSameQuery: true,
    sameAsRelative: true,
    sameAsNoQuery: false,
  });
  expect(exitCode).toBe(0);
});

test.concurrent("static import of a file:// URL keeps the query string in the module key", async () => {
  using dir = tempDir("import-query-file-url-static", {
    "target.mjs": `(globalThis.hits ??= []).push(import.meta.url);`,
  });
  const base = Bun.pathToFileURL(path.join(String(dir), "target.mjs")).href;
  await Bun.write(
    path.join(String(dir), "entry.mjs"),
    [
      `import ${JSON.stringify(base + "?a")};`,
      `import ${JSON.stringify(base + "?b")};`,
      `console.log(JSON.stringify(globalThis.hits.map(u => u.slice(u.lastIndexOf("/") + 1))));`,
    ].join("\n"),
  );
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["target.mjs?a", "target.mjs?b"]);
  expect(exitCode).toBe(0);
});

test.concurrent("static imports of a file:// URL with distinct queries evaluate distinct instances", async () => {
  using dir = tempDir("import-query-file-url-static-instances", {
    "target.js": `export const captured = globalThis.__token;`,
    "setup1.js": `globalThis.__token = "one";`,
    "setup2.js": `globalThis.__token = "two";`,
  });
  const target = Bun.pathToFileURL(path.join(String(dir), "target.js")).href;
  await Bun.write(
    path.join(String(dir), "entry.js"),
    [
      `import "./setup1.js";`,
      `import { captured as first } from ${JSON.stringify(target + "?v=1")};`,
      `import "./setup2.js";`,
      `import { captured as second } from ${JSON.stringify(target + "?v=2")};`,
      `console.log(JSON.stringify({ first, second }));`,
    ].join("\n"),
  );
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // Same output as Node: "?v=2" is a second instance, evaluated after setup2.js.
  expect(JSON.parse(stdout.trim())).toEqual({ first: "one", second: "two" });
  expect(exitCode).toBe(0);
});

test("Bun.resolveSync with non-ASCII specifier and query string", async () => {
  using dir = tempDir("resolve-query-nonascii", {
    "target.js": ``,
    "entry.js": `console.log(JSON.stringify(Bun.resolveSync("./target.js?v=caf\u00e9-\u65e5\u672c\u8a9e", import.meta.dir)));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const resolved = JSON.parse(stdout.trim());
  expect(resolved).toEndWith("target.js?v=caf\u00e9-\u65e5\u672c\u8a9e");
  expect(exitCode).toBe(0);
});
