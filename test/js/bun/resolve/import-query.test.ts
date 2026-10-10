import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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

// A builtin takes no query: Node reports `path?v=2` as a module that does not exist. The name that is left when
// the query is cut is the builtin's, so it is not a package to look up in node_modules or in the registry either.
describe("a builtin's name with a ?query", () => {
  const specifiers = ["path?v=2", "path?", "fs/promises?x", "ws?x", "bun?x"];
  const every = (code: string) => specifiers.map(() => code);
  const notFound = {
    "static import": every("ERR_MODULE_NOT_FOUND"),
    "export from": every("ERR_MODULE_NOT_FOUND"),
    "import() of a literal": every("ERR_MODULE_NOT_FOUND"),
    "require() of a literal": every("MODULE_NOT_FOUND"),
    "import()": every("ERR_MODULE_NOT_FOUND"),
    "require()": every("MODULE_NOT_FOUND"),
    "require.resolve()": every("MODULE_NOT_FOUND"),
    "createRequire()": every("MODULE_NOT_FOUND"),
    "import.meta.resolve()": every("ERR_MODULE_NOT_FOUND"),
    "Bun.resolveSync()": every("ERR_MODULE_NOT_FOUND"),
  };

  // What naming a module gives: the code of the error, or what it loaded. A package of these fixtures exports its
  // own path.
  const outcome = `async run => {
    try {
      const value = await run();
      const exported = typeof value === "string" ? value : value.default;
      return typeof exported === "string" ? "loaded " + exported : "loaded a builtin";
    } catch (e) {
      return e.code;
    }
  }`;

  // Every way to name a module, with each specifier: as a literal (an import record of the file) and as a value.
  const files: Record<string, string> = {
    "forms.cjs": `module.exports = { require: s => require(s), resolve: s => require.resolve(s) };`,
    "run.mjs": `
      import { createRequire } from "node:module";
      import cjs from "./forms.cjs";
      const specifiers = ${JSON.stringify(specifiers)};
      const forms = {
        "static import": i => import("./static-" + i + ".mjs"),
        "export from": i => import("./reexport-" + i + ".mjs"),
        "import() of a literal": i => cjs.require("./literal-" + i + ".cjs").imp(),
        "require() of a literal": i => cjs.require("./literal-" + i + ".cjs").req(),
        "import()": i => import(specifiers[i]),
        "require()": i => cjs.require(specifiers[i]),
        "require.resolve()": i => cjs.resolve(specifiers[i]),
        "createRequire()": i => createRequire(import.meta.url)(specifiers[i]),
        "import.meta.resolve()": i => import.meta.resolve(specifiers[i]),
        "Bun.resolveSync()": i => Bun.resolveSync(specifiers[i], import.meta.dir),
      };
      const outcome = ${outcome};
      const out = {};
      for (const [form, run] of Object.entries(forms)) {
        out[form] = [];
        for (let i = 0; i < specifiers.length; i++) out[form].push(await outcome(() => run(i)));
      }
      const controls = {};
      for (const specifier of process.argv.slice(2)) controls[specifier] = await outcome(() => cjs.require(specifier));
      console.log(JSON.stringify({ out, controls }));
    `,
    "entry.mjs": `import "path?v=2"; console.log("entry ran");`,
  };
  specifiers.forEach((specifier, i) => {
    const literal = JSON.stringify(specifier);
    files[`static-${i}.mjs`] = `import * as m from ${literal}; export default m.default;`;
    files[`reexport-${i}.mjs`] = `export { default } from ${literal};`;
    files[`literal-${i}.cjs`] = `exports.req = () => require(${literal}); exports.imp = () => import(${literal});`;
  });

  // Nothing listens on the default registry: a test that expects no install does not reach the network if it fails.
  async function run(cwd: string, args: string[], registry = "http://127.0.0.1:1/") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, BUN_CONFIG_REGISTRY: registry, NPM_CONFIG_REGISTRY: registry },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("does not load the package of that name in node_modules", async () => {
    const packages: Record<string, string> = {};
    for (const name of ["path", "fs", "ws", "bun", "lodashy"]) {
      packages[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", main: "index.js" });
      packages[`node_modules/${name}/index.js`] = `module.exports = "node_modules/${name}";`;
    }
    packages["node_modules/fs/promises.js"] = `module.exports = "node_modules/fs/promises.js";`;
    using dir = tempDir("import-query-builtin-node-modules", { ...files, ...packages });

    const controls = ["path", "node:path?v=2", "lodashy?v=1", "path/"];
    const { stdout, stderr, exitCode } = await run(String(dir), ["run.mjs", ...controls]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      out: notFound,
      controls: {
        "path": "loaded a builtin",
        // Bun's code for this was already Node's.
        "node:path?v=2": "ERR_UNKNOWN_BUILTIN_MODULE",
        // A package that is no builtin still takes a query.
        "lodashy?v=1": "loaded node_modules/lodashy",
        // As in Node, a trailing slash names the package and not the builtin.
        "path/": "loaded node_modules/path",
      },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("does not ask the registry for a package of that name", async () => {
    using dir = tempDir("import-query-builtin-autoinstall", files);
    const requests: string[] = [];
    await using registry = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(new URL(req.url).pathname);
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      },
    });

    // `--install=force` installs whatever the resolver takes for a package, with or without a node_modules.
    const imported = await run(String(dir), ["--install=force", "run.mjs"], registry.url.href);
    expect(imported.stderr).toBe("");
    expect(JSON.parse(imported.stdout)).toEqual({ out: notFound, controls: {} });

    const entry = await run(String(dir), ["--install=force", "entry.mjs"], registry.url.href);
    expect(entry.stdout).toBe("");
    expect(entry.stderr).toContain("Cannot find package 'path?v=2'");

    expect(requests).toEqual([]);
    expect({ imported: imported.exitCode, entry: entry.exitCode }).toEqual({ imported: 0, entry: 1 });
  });

  // Under `--expose-internals` an `internal/` module is a builtin too, and `internal` is a package's name.
  test.concurrent("does not load node_modules/internal for an internal/ module under --expose-internals", async () => {
    using dir = tempDir("import-query-builtin-expose-internals", {
      "node_modules/internal/package.json": JSON.stringify({ name: "internal", version: "1.0.0" }),
      "node_modules/internal/validators.js": `module.exports = "node_modules/internal/validators.js";`,
      "run.cjs": `
        const outcome = ${outcome};
        (async () => {
          console.log(
            JSON.stringify([
              await outcome(() => require("internal/validators")),
              await outcome(() => require("internal/validators?x")),
              await outcome(() => import("internal/validators?x")),
            ]),
          );
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--expose-internals", "run.cjs"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["loaded a builtin", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]);
    expect(exitCode).toBe(0);
  });
});
