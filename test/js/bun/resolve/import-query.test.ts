import { beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
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
  const second = await import("./import-query-fixture.ts?query" as string);
  const first = await import("./import-query-fixture.ts");
  expect(second.url).toBe(first.url + "?query");
  expect(globalThis.importQueryFixtureOrder).toEqual([resolvedURL + "?query", resolvedURL]);
});

test("[no query, query]", async () => {
  const first = await import("./import-query-fixture.ts");
  const second = await import("./import-query-fixture.ts?query" as string);
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
  expect({
    stdout: stdout.trim(),
    stderr,
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
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
  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
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
  expect({
    stdout: stdout.trim(),
    stderr,
    exitCode,
    signalCode: proc.signalCode,
  }).toEqual({
    stdout: JSON.stringify(`TypeError: ${NAPI_IMPORT_ERROR}`),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
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

test.concurrent.skipIf(isWindows)("a %3F in the path of a file:// URL is not a query", async () => {
  const targetSource = `
    import { value } from "./dep.mjs";
    (globalThis.literalQuestionHits ??= []).push(import.meta.url);
    export { value };
    export const url = import.meta.url;
  `;
  using dir = tempDir("import-query-file-url-literal-question", {
    "dep.mjs": `export const value = 42;`,
    "target?copy.mjs": targetSource,
  });
  const target = Bun.pathToFileURL(path.join(String(dir), "target?copy.mjs")).href;
  await Bun.write(
    path.join(String(dir), "entry.mjs"),
    [
      `import * as plain from ${JSON.stringify(target)};`,
      `import * as queried from ${JSON.stringify(target + "?v=1")};`,
      `import * as fragmented from ${JSON.stringify(target + "#a")};`,
      `const dynamicPlain = await import(${JSON.stringify(target)});`,
      `console.log(JSON.stringify({`,
      `  urls: [plain.url, queried.url, fragmented.url],`,
      `  values: [plain.value, queried.value, fragmented.value],`,
      `  distinct: plain !== queried && plain !== fragmented && queried !== fragmented,`,
      `  dynamicIsStatic: dynamicPlain === plain,`,
      `  hits: globalThis.literalQuestionHits,`,
      `}));`,
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
  expect({ ...JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
    urls: [target, target + "?v=1", target + "#a"],
    values: [42, 42, 42],
    distinct: true,
    dynamicIsStatic: true,
    hits: [target, target + "?v=1", target + "#a"],
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.skipIf(isWindows)(
  "file URL resolution preserves encoded path delimiters and raw suffixes",
  async () => {
    using dir = tempDir("resolve-file-url-encoded-delimiters", {
      "target?copy.mjs": ``,
      "entry.mjs": `
      import { pathToFileURL } from "node:url";
      const targetPath = import.meta.dir + "/target?copy.mjs";
      const target = pathToFileURL(targetPath).href;
      console.log(JSON.stringify({
        sync: Bun.resolveSync(target, import.meta.dir),
        query: Bun.resolveSync(target + "?v=1", import.meta.dir),
        fragment: Bun.resolveSync(target + "#a", import.meta.dir),
        async: await Bun.resolve(target + "?v=2#a", import.meta.dir),
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
    const targetPath = path.join(String(dir), "target?copy.mjs");
    expect({ ...JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      sync: targetPath,
      query: targetPath + "?v=1",
      fragment: targetPath + "?#a",
      async: targetPath + "?v=2#a",
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(isWindows)("mock.module canonicalizes escapes in a file URL containing %3F", async () => {
  using dir = tempDir("mock-file-url-literal-question", {
    "target?copy.mjs": `export const value = "real";`,
    "entry.test.mjs": `
      import { expect, mock, test } from "bun:test";
      const target = new URL("./target%3fcopy.mjs?v=1", import.meta.url).href;
      mock.module(target, () => ({ value: "mocked" }));
      test("mocked encoded path", async () => {
        expect(target).toContain("%3f");
        expect((await import(target)).value).toBe("mocked");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "entry.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)("--isolate caches a file URL containing %3F under its module key", async () => {
  using dir = tempDir("isolate-file-url-literal-question", {
    "target?copy.mjs": `export const value = "v1";`,
    "a.test.mjs": `
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      const target = new URL("./target%3Fcopy.mjs", import.meta.url).href;
      test("populate cache", async () => {
        expect((await import(target)).value).toBe("v1");
        writeFileSync(new URL("./target%3Fcopy.mjs", import.meta.url), 'export const value = "v2";');
      });
    `,
    "b.test.mjs": `
      import { expect, test } from "bun:test";
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
      const target = new URL("./target%3Fcopy.mjs", import.meta.url).href;
      test("reuse cache", async () => {
        expect((await import(target)).value).toBe("v1");
        expect(isolatedModuleCacheSourceType(target)).toBe("BunTranspiledModule");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.mjs", "b.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)(
  "CommonJS file URLs preserve %3F path bytes without changing query handling",
  async () => {
    using dir = tempDir("require-file-url-literal-question", {
      "dep.cjs": `module.exports = 42;`,
      "target?copy.cjs": `module.exports = {
        dep: require("./dep.cjs"),
        filename: require("node:path").basename(__filename),
        dirname: require("node:path").basename(__dirname),
      };`,
      "extensionless?target.js": `module.exports = "extension-resolved";`,
      "collision.cjs": `module.exports = "query";`,
      "collision.cjs?copy.cjs": `module.exports = "literal";`,
      "ordinary.cjs": `module.exports = {};`,
      "entry.cjs": `
      const path = require("node:path");
      const { pathToFileURL } = require("node:url");
      const literal = pathToFileURL(path.join(__dirname, "target?copy.cjs")).href;
      const extensionless = pathToFileURL(path.join(__dirname, "extensionless?target")).href;
      const collision = pathToFileURL(path.join(__dirname, "collision.cjs?copy.cjs")).href;
      const ordinary = pathToFileURL(path.join(__dirname, "ordinary.cjs")).href;
      const literalPlain = require(literal);
      const literalQuery = require(literal + "?v=1");
      const literalSpaceQuery = require(literal + "?q=a b");
      const ordinaryFileURLQuery = require(ordinary + "?v=1");
      const ordinaryRelativeQuery = require("./ordinary.cjs?v=2");
      const first = process.argv[2];
      const collisionModules = {
        literal: () => require(collision),
        query: () => require("./collision.cjs?copy.cjs"),
      };
      collisionModules[first]();
      console.log(JSON.stringify({
        literalPlain,
        literalQuery,
        literalSpaceQuery,
        literalInstancesAreDistinct:
          literalPlain !== literalQuery && literalPlain !== literalSpaceQuery && literalQuery !== literalSpaceQuery,
        literalResolveMatches: require.resolve(literal) === literal,
        literalQueryResolveMatches: require.resolve(literal + "?v=1") === literal + "?v=1",
        literalSpaceQueryResolveMatches: require.resolve(literal + "?q=a b") === literal + "?q=a%20b",
        literalCacheKeysAreDistinct:
          require.cache[require.resolve(literal)] !== require.cache[require.resolve(literal + "?v=1")],
        ordinaryInstancesAreDistinct: ordinaryFileURLQuery !== ordinaryRelativeQuery,
        extensionless: require(extensionless),
        extensionlessResolveMatches:
          require.resolve(extensionless) ===
          pathToFileURL(path.join(__dirname, "extensionless?target.js")).href,
        collisionLiteral: collisionModules.literal(),
        collisionQuery: collisionModules.query(),
        collisionKeysAreDistinct:
          require.resolve(collision) !== require.resolve("./collision.cjs?copy.cjs"),
      }));
    `,
    });
    const results = await Promise.all(
      ["literal", "query"].map(async first => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "entry.cjs", first],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return {
          first,
          result: stdout ? JSON.parse(stdout.trim()) : null,
          stderr,
          exitCode,
        };
      }),
    );
    const literalResult = {
      dep: 42,
      filename: "target?copy.cjs",
      dirname: path.basename(String(dir)),
    };
    const expected = {
      literalPlain: literalResult,
      literalQuery: literalResult,
      literalSpaceQuery: literalResult,
      literalInstancesAreDistinct: true,
      literalResolveMatches: true,
      literalQueryResolveMatches: true,
      literalSpaceQueryResolveMatches: true,
      literalCacheKeysAreDistinct: true,
      ordinaryInstancesAreDistinct: true,
      extensionless: "extension-resolved",
      extensionlessResolveMatches: true,
      collisionLiteral: "literal",
      collisionQuery: "query",
      collisionKeysAreDistinct: true,
    };
    expect(results).toEqual([
      { first: "literal", result: expected, stderr: "", exitCode: 0 },
      { first: "query", result: expected, stderr: "", exitCode: 0 },
    ]);
  },
);

test.concurrent.skipIf(isWindows)(
  "file URL referrers preserve a literal question mark in their directory",
  async () => {
    using dir = tempDir("file-url-referrer-directory", {
      "project?copy/main.mjs": `import { value } from "./dep.mjs"; export { value };`,
      "project?copy/dep.mjs": `export const value = 42;`,
    });
    const url = Bun.pathToFileURL(path.join(String(dir), "project?copy", "main.mjs")).href;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log((await import(${JSON.stringify(url)})).value)`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "42\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent.skipIf(isWindows)(
  "require(esm) fetches file URL dependencies with literal question marks",
  async () => {
    using dir = tempDir("require-esm-file-url", {
      "value?copy.mjs": `export const value = 42;`,
    });
    const url = Bun.pathToFileURL(path.join(String(dir), "value?copy.mjs")).href;
    await Bun.write(path.join(String(dir), "entry.mjs"), `export { value } from ${JSON.stringify(url)};`);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'console.log(require("./entry.mjs").value)'],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "42\n",
      stderr: "",
      exitCode: 0,
    });
  },
);

test.concurrent("mock.module matches a suffixed file URL without a file on disk", async () => {
  using dir = tempDir("mock-missing-file-url", {
    "entry.test.mjs": `
      import { expect, mock, test } from "bun:test";
      const url = new URL("./missing.mjs?v=1#mock", import.meta.url).href;
      mock.module(url, () => ({ value: "mocked" }));
      test("virtual URL", async () => expect((await import(url)).value).toBe("mocked"));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "entry.test.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)("CommonJS lookup paths preserve literal question marks", async () => {
  const moduleSource = `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const Module = require("node:module");
    const directory = path.dirname(__filename);
    assert.deepEqual(require.resolve.paths("./dep.cjs"), [directory]);
    assert.deepEqual(Module._resolveLookupPaths("./dep.cjs", module), [directory]);
    assert.deepEqual(Module._resolveLookupPaths("./dep.cjs", { filename: __filename }), [directory]);
    assert.equal(require.resolve.paths("dep")[0], path.join(directory, "node_modules"));
    assert.equal(module.paths[0], path.join(directory, "node_modules"));
    for (const from of [__filename, require("node:url").pathToFileURL(__filename)]) {
      const created = Module.createRequire(from);
      assert.deepEqual(created.resolve.paths("./dep.cjs"), [directory]);
      assert.equal(created.resolve.paths("dep")[0], path.join(directory, "node_modules"));
    }
    module.filename = path.join(directory, "override?path", "main.cjs");
    assert.deepEqual(require.resolve.paths("./dep.cjs"), [path.dirname(module.filename)]);
    module.exports = "ok";
  `;
  using dir = tempDir("cjs-lookup-literal-question", {
    "project?copy/main.cjs": moduleSource,
    "ordinary.cjs": moduleSource,
    "entry.mjs": `
      import { pathToFileURL } from "node:url";
      const literal = pathToFileURL(import.meta.dir + "/project?copy/main.cjs").href;
      const ordinary = pathToFileURL(import.meta.dir + "/ordinary.cjs").href;
      console.log((await import(literal + "?generation=1")).default);
      console.log((await import(ordinary + "?generation=1")).default);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "ok\nok\n",
    stderr: "",
    exitCode: 0,
  });
});
