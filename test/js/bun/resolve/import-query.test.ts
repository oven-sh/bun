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

// Node rejects a `?query` on a bare package *root* (`pkg?v=1`, `@scope/pkg?v=1`,
// `#name?v=1`, self-reference by name). Stripping it made `import("pkg?v=1")`
// evaluate a second instance of the whole package, splitting singleton state.
// Subpaths (`pkg/sub?q`) are left to the exports/imports map, since Node's
// answer there depends on whether the subpath matched an exact key or a
// suffix-less wildcard.
describe("?query on a bare package root does not resolve", () => {
  const pkgFiles = {
    "node_modules/qk/package.json": JSON.stringify({ name: "qk", main: "./i.js", exports: { ".": "./i.js" } }),
    "node_modules/qk/i.js": "globalThis.__qk = (globalThis.__qk || 0) + 1; module.exports = { inst: globalThis.__qk };",
    "node_modules/@sc/pk/package.json": JSON.stringify({ name: "@sc/pk", main: "./i.js", exports: { ".": "./i.js" } }),
    "node_modules/@sc/pk/i.js":
      "globalThis.__scpk = (globalThis.__scpk || 0) + 1; module.exports = { inst: globalThis.__scpk };",
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
        for (const name of ["qk", "@sc/pk"]) {
          out.insts.push(require(name).inst);
          for (const spec of [name + "?v=1", name + "?v=2"]) {
            try {
              out.insts.push(require(spec).inst);
            } catch (e) {
              out.errors.push(e.code || e.name);
            }
          }
          // The un-suffixed specifier must still be the one-and-only instance.
          out.insts.push(require(name).inst);
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      insts: [1, 1, 1, 1],
      errors: ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("import('pkg?v=N') does not evaluate a new instance of the package", async () => {
    using dir = tempDir("import-query-bare-import", {
      ...pkgFiles,
      "entry.mjs": `
        const out = { insts: [], errors: [] };
        for (const name of ["qk", "@sc/pk"]) {
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
      insts: [1, 1, 1, 1],
      errors: ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("?query on a wildcard exports/imports subpath still resolves (control)", async () => {
    // Node ESM accepts a ?query on a suffix-less wildcard key: the `*` captures
    // the `?` into patternMatch, the href-replace substitution lands it in the
    // URL `.search`, and the pathname stats. The rejection is limited to the
    // package root so this Node behaviour stays intact.
    using dir = tempDir("import-query-bare-wildcard", {
      "package.json": JSON.stringify({ name: "app", type: "module", imports: { "#hot/*": "./src/*" } }),
      "src/config.js": "globalThis.__wc = (globalThis.__wc || 0) + 1; export const inst = globalThis.__wc;",
      "node_modules/wp/package.json": JSON.stringify({ name: "wp", type: "module", exports: { "./*": "./dist/*" } }),
      "node_modules/wp/dist/foo.js":
        "globalThis.__wp = (globalThis.__wp || 0) + 1; export const inst = globalThis.__wp;",
      "entry.mjs": `
        const out = [];
        for (const spec of ["#hot/config.js", "#hot/config.js?v=1", "#hot/config.js?v=2"]) {
          out.push((await import(spec)).inst);
        }
        for (const spec of ["wp/foo.js", "wp/foo.js?v=1", "wp/foo.js?v=2"]) {
          out.push((await import(spec)).inst);
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
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual([1, 2, 3, 1, 2, 3]);
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

  test.concurrent("import('#name?v=N') via package.json imports / self-reference by name", async () => {
    // Both routes go through handle_esm_resolution which sets
    // IS_FROM_NODE_MODULES, so the flag check catches them even though the
    // resolved file lives outside any node_modules dir.
    using dir = tempDir("import-query-bare-hash-self", {
      "package.json": JSON.stringify({
        name: "myapp",
        imports: { "#internal": "./src/util.js" },
        exports: { ".": "./index.js" },
      }),
      "index.js": "globalThis.__ix = (globalThis.__ix || 0) + 1; module.exports = { inst: globalThis.__ix };",
      "src/util.js": "globalThis.__iu = (globalThis.__iu || 0) + 1; module.exports = { inst: globalThis.__iu };",
      "entry.mjs": `
        const out = { insts: [], errors: [] };
        for (const name of ["#internal", "myapp"]) {
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
      insts: [1, 1, 1, 1],
      errors: ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("import('pkg?v=N') on a package resolved via NODE_PATH", async () => {
    using dir = tempDir("import-query-bare-nodepath", {
      "mylibs/npk/package.json": JSON.stringify({ name: "npk", main: "./i.js" }),
      "mylibs/npk/i.js": "globalThis.__np = (globalThis.__np || 0) + 1; module.exports = { inst: globalThis.__np };",
      "app/entry.mjs": `
        const out = { insts: [], errors: [] };
        out.insts.push((await import("npk")).default.inst);
        for (const spec of ["npk?v=1", "npk?v=2"]) {
          try {
            out.insts.push((await import(spec)).default.inst);
          } catch (e) {
            out.errors.push(e.code || e.name);
          }
        }
        out.insts.push((await import("npk")).default.inst);
        console.log(JSON.stringify(out));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: { ...bunEnv, NODE_PATH: join(String(dir), "mylibs") },
      cwd: join(String(dir), "app"),
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
