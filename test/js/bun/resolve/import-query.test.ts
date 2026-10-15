import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
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

// A `?` is a legal byte of a POSIX file name (https://github.com/oven-sh/bun/issues/7928). Windows does not allow it.
describe.concurrent.skipIf(isWindows)("a `?` in a file or folder name", () => {
  const dep = {
    "dep.mjs": `export default "dep.mjs"; export const url = import.meta.url;`,
    "dep.cjs": `module.exports = __filename;`,
    "config.json": `{ "json": true }`,
    "worker.mjs": `postMessage(import.meta.path.split("/").slice(-2).join("/"));`,
    "child.cjs": `process.send(__filename.split("/").slice(-2).join("/"), () => process.exit(0));`,
    // The last two segments of what each way to load a file sees.
    "main.mjs": `
      import dep from "./dep.mjs";
      import config from "./config.json";
      const tail = path => path.split("/").slice(-2).join("/");
      console.log(JSON.stringify({
        main: import.meta.main,
        path: tail(import.meta.path),
        dir: tail(import.meta.dir + "/"),
        file: import.meta.file,
        url: tail(import.meta.url),
        dep,
        json: config.json,
        require: tail(require("./dep.cjs")),
        withQuery: tail((await import("./dep.mjs?v=1")).url),
      }));
    `,
  };
  const files = {
    ...Object.fromEntries(Object.entries(dep).map(([name, source]) => ["end?/" + name, source])),
    ...Object.fromEntries(Object.entries(dep).map(([name, source]) => ["mi?d/" + name, source])),
    "we?ird.mjs": `export default "we?ird.mjs"; console.log(import.meta.file);`,
    "we?ird.cjs": `module.exports = "we?ird.cjs";`,
    // Beside each of these is what the part before the "?" names.
    "app?/main.mjs": `console.log("app?/main.mjs");`,
    "app/index.mjs": `console.log("app/index.mjs");`,
    "q?/x.cjs": `module.exports = require("./dep.cjs");`,
    "q?/dep.cjs": `module.exports = "q?/dep.cjs";`,
    "q": `module.exports = "the file q";`,
    "a.cjs?/b.cjs": `module.exports = "a.cjs?/b.cjs";`,
    "a.cjs": `module.exports = "a.cjs";`,
    "a.mjs?/b.mjs": `export default "the file b.mjs";`,
    "a.mjs": `export default "a.mjs with " + new URL(import.meta.url).search;`,
    "c.mjs?/d.mjs": `export default "the file d.mjs";`,
    "c.mjs": `export default "c.mjs";`,
    "x.mjs": `export default "x.mjs";`,
    "end?/addon.node": "",
  };
  async function run(name: string, source: string | undefined, ...args: string[]) {
    using dir = tempDir("import-query-question-mark", source === undefined ? files : { ...files, [name]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, name],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.each(["end?", "mi?d"])("bun runs a file in the folder %s, with its imports", async folder => {
    const { stdout, stderr, exitCode } = await run(`./${folder}/main.mjs`, undefined);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        main: true,
        path: `${folder}/main.mjs`,
        dir: `${folder}/`,
        file: "main.mjs",
        url: `${folder.replace("?", "%3F")}/main.mjs`,
        dep: "dep.mjs",
        json: true,
        require: `${folder}/dep.cjs`,
        withQuery: `${folder.replace("?", "%3F")}/dep.mjs?v=1`,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([
    ["./we?ird.mjs", [], "we?ird.mjs"],
    ["./app?/main.mjs", [], "app?/main.mjs"],
    ["./app?/main.mjs", ["run"], "app?/main.mjs"],
    ["./x.mjs", ["--preload", "./we?ird.mjs"], "we?ird.mjs"],
  ])("bun runs %s (%j)", async (name, args, stdout) => {
    expect(await run(name, undefined, ...args)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test("a worker and a forked process run a file in such a folder", async () => {
    const source = `
      import { fork } from "node:child_process";
      const worker = new Worker("./mi?d/worker.mjs");
      const fromWorker = await new Promise((resolve, reject) => {
        worker.onmessage = event => resolve(event.data);
        worker.onerror = reject;
      });
      worker.terminate();
      const fromChild = await new Promise(resolve => fork("./end?/child.cjs").on("message", resolve));
      console.log(JSON.stringify({ fromWorker, fromChild }));
    `;
    const { stdout, stderr, exitCode } = await run("entry.mjs", source);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: { fromWorker: "mi?d/worker.mjs", fromChild: "end?/child.cjs" },
      stderr: "",
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/7928
  test.each([[[]], [["./some-path?/my.test.js", "./so?me"]]])("bun test %j runs the test files in such folders", async args => {
    const testFile = `
      import { expect, test } from "bun:test";
      import { folder } from "./dep.js";
      test("in " + folder, () => {
        expect(import.meta.dir.split("/").pop()).toBe(folder);
        console.log("RAN " + folder);
      });
    `;
    using dir = tempDir("import-query-question-mark-test", {
      "some-path?/my.test.js": testFile,
      "some-path?/dep.js": `export const folder = "some-path?";`,
      "so?me/my.test.js": testFile,
      "so?me/dep.js": `export const folder = "so?me";`,
      // What the part before each "?" names.
      "some-path/index.js": `console.log("SHOULD NOT RUN some-path/index.js");`,
      "so/index.js": `console.log("SHOULD NOT RUN so/index.js");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RAN some-path?");
    expect(stdout).toContain("RAN so?me");
    expect(stdout).not.toContain("SHOULD NOT RUN");
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });

  // As in node: require() takes a path. A query is bun's addition to it, for a name that is not there.
  test("require() reads a `?` as part of a name that exists", async () => {
    const source = `
      const { createRequire } = require("node:module");
      const { relative, resolve } = require("node:path");
      const here = path => relative(__dirname, path);
      const load = id => {
        try {
          return [here(require.resolve(id)), here(String(require(id)))];
        } catch (error) {
          return error.code;
        }
      };
      const query = load("./a.cjs?v=1");
      delete require.cache[require.resolve("./a.cjs?v=1")];
      console.log(JSON.stringify({
        "./end?/dep.cjs": load("./end?/dep.cjs"),
        "./mi?d/dep.cjs": load("./mi?d/dep.cjs"),
        "./we?ird.cjs": load("./we?ird.cjs"),
        "./we?ird.cjs?v=1": load("./we?ird.cjs?v=1"),
        "absolute": load(resolve("mi?d/dep.cjs")),
        "./a.cjs?v=1": query,
        "./a.cjs?v=1 again": load("./a.cjs?v=1"),
        "./a.cjs?a=/b/c": load("./a.cjs?a=/b/c"),
        "./a.cjs?/b.cjs": load("./a.cjs?/b.cjs"),
        "./q?/x.cjs": load("./q?/x.cjs"),
        "createRequire": createRequire(resolve("q?/x.cjs"))("./dep.cjs"),
        "./end%3F/dep.cjs": load("./end%3F/dep.cjs"),
      }));
    `;
    const { stdout, stderr, exitCode } = await run("entry.cjs", source);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        "./end?/dep.cjs": ["end?/dep.cjs", "end?/dep.cjs"],
        "./mi?d/dep.cjs": ["mi?d/dep.cjs", "mi?d/dep.cjs"],
        "./we?ird.cjs": ["we?ird.cjs", "we?ird.cjs"],
        "./we?ird.cjs?v=1": ["we?ird.cjs?v=1", "we?ird.cjs"],
        "absolute": ["mi?d/dep.cjs", "mi?d/dep.cjs"],
        "./a.cjs?v=1": ["a.cjs?v=1", "a.cjs"],
        "./a.cjs?v=1 again": ["a.cjs?v=1", "a.cjs"],
        "./a.cjs?a=/b/c": ["a.cjs?a=/b/c", "a.cjs"],
        "./a.cjs?/b.cjs": ["a.cjs?/b.cjs", "a.cjs?/b.cjs"],
        "./q?/x.cjs": ["q?/x.cjs", "q?/dep.cjs"],
        "createRequire": "q?/dep.cjs",
        "./end%3F/dep.cjs": "MODULE_NOT_FOUND",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // As in node: a specifier is a URL, and the path of a file URL spells a "?" as "%3F".
  test("an ES module specifier has a query from its first `?`", async () => {
    const source = `
      import { resolve } from "node:path";
      const load = async specifier => {
        try {
          return (await import(specifier)).default;
        } catch (error) {
          return error.code;
        }
      };
      const url = path => Bun.pathToFileURL(resolve(path)).href;
      console.log(JSON.stringify({
        "./end?/dep.mjs": await load("./end?/dep.mjs"),
        "./we?ird.mjs": await load("./we?ird.mjs"),
        "./a.mjs?/b.mjs": await load("./a.mjs?/b.mjs"),
        "./a.mjs?v=1": await load("./a.mjs?v=1"),
        "./a.mjs?a=/b/c": await load("./a.mjs?a=/b/c"),
        "file URL of end?/dep.mjs": await load(url("end?/dep.mjs")),
        "file URL of mi?d/dep.mjs": await load(url("mi?d/dep.mjs")),
        "file URL of c.mjs?/d.mjs": await load(url("c.mjs?/d.mjs")),
        "Bun.resolveSync of a file URL": Bun.resolveSync(url("mi?d/dep.mjs"), import.meta.dir).slice(import.meta.dir.length),
      }));
    `;
    const { stdout, stderr, exitCode } = await run("entry.mjs", source);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        "./end?/dep.mjs": "ERR_MODULE_NOT_FOUND",
        "./we?ird.mjs": "ERR_MODULE_NOT_FOUND",
        "./a.mjs?/b.mjs": "a.mjs with ?/b.mjs",
        "./a.mjs?v=1": "a.mjs with ?v=1",
        "./a.mjs?a=/b/c": "a.mjs with ?a=/b/c",
        "file URL of end?/dep.mjs": "dep.mjs",
        "file URL of mi?d/dep.mjs": "dep.mjs",
        "file URL of c.mjs?/d.mjs": "the file d.mjs",
        "Bun.resolveSync of a file URL": "/mi?d/dep.mjs",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a .node addon is told by the end of the path, not of the query", async () => {
    const source = `
      const load = id => {
        try {
          return require(id);
        } catch (error) {
          return [error.code, error.message.includes("end?/addon.node")];
        }
      };
      import("./x.mjs?from=addon.node").then(esm => {
        console.log(JSON.stringify({
          "./end?/addon.node": load("./end?/addon.node"),
          "./end?/addon.node?v=1": load("./end?/addon.node?v=1"),
          "./x.mjs?from=addon.node": esm.default,
        }));
      });
    `;
    const { stdout, stderr, exitCode } = await run("entry.cjs", source);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: {
        "./end?/addon.node": ["ERR_DLOPEN_FAILED", true],
        "./end?/addon.node?v=1": ["ERR_DLOPEN_FAILED", true],
        "./x.mjs?from=addon.node": "x.mjs",
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

// `bun <file>.html` imports the file it was given. Windows does not allow `?` in a file name.
test.skipIf(isWindows)("bun serves an HTML entry point in a folder with `?` in its name", async () => {
  using dir = tempDir("import-query-question-mark-html", {
    "pa?ge/index.html": `<!DOCTYPE html><html><head><title>in pa?ge</title></head><body></body></html>`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./pa?ge/index.html", "--port=0"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdout = "";
  let url: string | undefined;
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    stdout += chunk;
    url = stdout.match(/http:\/\/\S+/)?.[0];
    if (url && stdout.includes("\n", stdout.indexOf(url))) break;
  }
  // The server prints its URL, or the process ends with the reason on stderr.
  if (!url) expect(await proc.stderr.text()).toBe("");
  const response = await fetch(url!);
  expect({ status: response.status, title: (await response.text()).match(/<title>(.*)<\/title>/)?.[1] }).toEqual({
    status: 200,
    title: "in pa?ge",
  });
});
