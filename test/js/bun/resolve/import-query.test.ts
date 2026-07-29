import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
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

// Node gives `?` URL-separator meaning only for relative/absolute ESM specifiers.
// A bare package specifier (`pkg`, `@scope/pkg/sub`) is not a URL: `?` is part of
// the package name / subpath and must reach the resolver verbatim. Stripping it
// made `import("pkg?v=1")` evaluate a second instance of the whole package,
// splitting singleton state.
describe("?query on a bare package specifier does not resolve", () => {
  const pkgFiles = {
    "node_modules/qk/package.json": JSON.stringify({
      name: "qk",
      main: "./i.js",
      exports: { ".": "./i.js", "./s": "./s.js" },
    }),
    "node_modules/qk/i.js": "globalThis.__qk = (globalThis.__qk || 0) + 1; module.exports = { inst: globalThis.__qk };",
    "node_modules/qk/s.js": 'module.exports = "SUB";',
  };

  const noExportsPkgFiles = {
    "node_modules/nx/package.json": JSON.stringify({ name: "nx", main: "./i.js" }),
    "node_modules/nx/i.js": "globalThis.__nx = (globalThis.__nx || 0) + 1; module.exports = { inst: globalThis.__nx };",
  };

  test.concurrent("require('pkg?v=N') does not evaluate a new instance of the package", async () => {
    using dir = tempDir("import-query-bare-require", {
      ...pkgFiles,
      "entry.cjs": `
        const out = { insts: [], errors: [] };
        out.insts.push(require("qk").inst);
        for (const spec of ["qk?v=1", "qk?v=2"]) {
          try {
            out.insts.push(require(spec).inst);
          } catch (e) {
            out.errors.push(e.code || e.name);
          }
        }
        // The un-suffixed specifier must still be the one-and-only instance.
        out.insts.push(require("qk").inst);
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      insts: [1, 1],
      errors: ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("import('pkg?v=N') does not evaluate a new instance of the package", async () => {
    using dir = tempDir("import-query-bare-import", {
      ...pkgFiles,
      "entry.mjs": `
        const out = { insts: [], errors: [] };
        out.insts.push((await import("qk")).default.inst);
        for (const spec of ["qk?v=1", "qk?v=2"]) {
          try {
            out.insts.push((await import(spec)).default.inst);
          } catch (e) {
            out.errors.push(e.code || e.name);
          }
        }
        out.insts.push((await import("qk")).default.inst);
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      insts: [1, 1],
      errors: ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("pkg/subpath?query is not matched against the exports map", async () => {
    using dir = tempDir("import-query-bare-subpath", {
      ...pkgFiles,
      "entry.mjs": `
        import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        const out = {};
        const go = (k, f) => { try { out[k] = f() } catch (e) { out[k] = "ERR:" + (e.code || e.name) } };
        go("plain", () => require("qk/s"));
        go("require", () => require("qk/s?x=1"));
        go("imr", () => import.meta.resolve("qk/s?x=1"));
        go("resolveSync", () => Bun.resolveSync("qk/s?x=1", import.meta.dir));
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
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    // `./s` is exported; `./s?x=1` is not. Previously `imr` returned a file URL
    // whose path ended in `/s.js%3Fx=1` (the query percent-encoded into the path).
    expect(out).toEqual({
      plain: "SUB",
      require: "ERR:MODULE_NOT_FOUND",
      imr: "ERR:ERR_MODULE_NOT_FOUND",
      resolveSync: "ERR:ERR_MODULE_NOT_FOUND",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("import('pkg?v=N') on a symlinked (workspace/link) package", async () => {
    // Bun realpaths symlinks by default, so the resolved `text` has no
    // `/node_modules/` component; the rejection must cover this layout too.
    using dir = tempDir("import-query-bare-symlink", {
      "packages/sk/package.json": JSON.stringify({ name: "sk", main: "./i.js", exports: { ".": "./i.js" } }),
      "packages/sk/i.js": "globalThis.__sk = (globalThis.__sk || 0) + 1; module.exports = { inst: globalThis.__sk };",
      "packages/sn/package.json": JSON.stringify({ name: "sn", main: "./i.js" }),
      "packages/sn/i.js": "globalThis.__sn = (globalThis.__sn || 0) + 1; module.exports = { inst: globalThis.__sn };",
      "app/node_modules/.keep": "",
      "app/entry.mjs": `
        const out = { insts: [], errors: [] };
        for (const name of ["sk", "sn"]) {
          out.insts.push((await import(name)).default.inst);
          for (const spec of [name + "?v=1", name + "?v=2"]) {
            try {
              out.insts.push((await import(spec)).default.inst);
            } catch (e) {
              out.errors.push(e.code || e.name);
            }
          }
          out.insts.push((await import(name)).default.inst);
        }
        console.log(JSON.stringify(out));
      `,
    });
    symlinkSync(join(String(dir), "packages/sk"), join(String(dir), "app/node_modules/sk"), "junction");
    symlinkSync(join(String(dir), "packages/sn"), join(String(dir), "app/node_modules/sn"), "junction");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: join(String(dir), "app"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      insts: [1, 1, 1, 1],
      errors: ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("?raw on a bare package subpath still loads as text (control)", async () => {
    using dir = tempDir("import-query-bare-raw", {
      "node_modules/tp/package.json": JSON.stringify({ name: "tp", main: "./i.js" }),
      "node_modules/tp/i.js": "module.exports = 0;",
      "node_modules/tp/data.txt": "RAW TEXT CONTENT",
      "entry.mjs": `
        const a = await import("tp/data.txt?raw");
        console.log(JSON.stringify(a.default));
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
    expect(JSON.parse(stdout.trim())).toBe("RAW TEXT CONTENT");
    expect(exitCode).toBe(0);
  });

  test.concurrent("import('pkg?v=N') on a package without an exports field", async () => {
    using dir = tempDir("import-query-bare-noexports", {
      ...noExportsPkgFiles,
      "entry.mjs": `
        const out = { insts: [], errors: [] };
        out.insts.push((await import("nx")).default.inst);
        for (const spec of ["nx?v=1", "nx?v=2"]) {
          try {
            out.insts.push((await import(spec)).default.inst);
          } catch (e) {
            out.errors.push(e.code || e.name);
          }
        }
        out.insts.push((await import("nx")).default.inst);
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      insts: [1, 1],
      errors: ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("?query on a tsconfig paths alias still resolves (control)", async () => {
    // A tsconfig `paths` alias is Bun-specific runtime resolution and resolves
    // outside node_modules, so the split-off query is kept and `?raw` works.
    using dir = tempDir("import-query-bare-tspaths", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "src/util.ts": "globalThis.__u = (globalThis.__u || 0) + 1; export const inst = globalThis.__u;",
      "src/shader.glsl": "VERTEX SHADER CODE",
      "entry.ts": `
        const out = {};
        out.a = (await import("@/util")).inst;
        out.b = (await import("@/util?v=1")).inst;
        out.c = (await import("@/util?v=2")).inst;
        out.raw = (await import("@/shader.glsl?raw")).default;
        console.log(JSON.stringify(out));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ a: 1, b: 2, c: 3, raw: "VERTEX SHADER CODE" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("?query on a relative ESM specifier still cache-busts (control)", async () => {
    using dir = tempDir("import-query-bare-control", {
      "rel.mjs": "globalThis.__rel = (globalThis.__rel || 0) + 1; export const inst = globalThis.__rel;",
      "entry.mjs": `
        const a = await import("./rel.mjs");
        const b = await import("./rel.mjs?v=1");
        const c = await import("./rel.mjs?v=2");
        console.log(JSON.stringify([a.inst, b.inst, c.inst]));
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
    expect(JSON.parse(stdout.trim())).toEqual([1, 2, 3]);
    expect(exitCode).toBe(0);
  });
});
