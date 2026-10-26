import { spawnSync } from "bun";
import { isModuleResolveFilenameSlowPathEnabled } from "bun:internal-for-testing";
import { describe, expect, it, mock } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isWindows, ospath, tempDir, unprivilegedSpawnOptions } from "harness";
import { mkfifo } from "mkfifo";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import sync from "./require-json.json";

const { path, dir, dirname, filename } = import.meta;

const tmpbase = tmpdir() + sep;

it("import.meta.require is settable", () => {
  const old = import.meta.require;
  const fn = mock(() => "hello");
  import.meta.require = fn;
  expect(import.meta.require("hello")).toBe("hello");
  import.meta.require = old;
  expect(fn).toHaveBeenCalledTimes(1);
});

it("import.meta.main", () => {
  const { exitCode } = spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "./main-test-script.js")],
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
    stdin: null,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.main follows a Bun.main override but not an own path property, is readable from a vm context, and is false in workers", async () => {
  using dir = tempDir("import-meta-main", {
    "entry.mjs": `
      import { runInNewContext } from "node:vm";
      import { Worker, isMainThread, parentPort } from "node:worker_threads";
      if (isMainThread) {
        const worker = new Worker(new URL(import.meta.url));
        const fromWorker = new Promise((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        const other = await import("./other.mjs");
        const entryPath = import.meta.path;
        const before = [import.meta.main, other.main()];
        const vmContext = [import.meta, other.meta].map(meta => runInNewContext("meta.main", { meta }));
        Bun.main = other.path;
        const after = [import.meta.main, other.main()];
        // main is computed from the module's own path, so swapping the visible path properties changes nothing.
        Object.defineProperty(import.meta, "path", { value: other.path });
        Object.defineProperty(other.meta, "path", { value: entryPath });
        const ownPath = [import.meta.main, other.main()];
        console.log(JSON.stringify({ before, vmContext, after, ownPath, worker: await fromWorker }));
        await worker.terminate();
      } else {
        parentPort.postMessage(import.meta.main);
      }
    `,
    "other.mjs": `
      export const meta = import.meta;
      export const path = import.meta.path;
      export const main = () => import.meta.main;
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({
    before: [true, false],
    vmContext: [true, false],
    after: [false, true],
    ownPath: [false, true],
    worker: false,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.resolveSync", () => {
  expect(import.meta.resolveSync("./" + import.meta.file, import.meta.path)).toBe(path);
});

it("Module.createRequire", () => {
  const require = Module.createRequire(import.meta.path);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);

  // check it works with URL objects
  expect(Module.createRequire(new URL(import.meta.url)).resolve(import.meta.path)).toBe(import.meta.path);
});

it("Module.createRequire works with a file url", () => {
  const require = Module.createRequire(import.meta.url);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);
});

it("Module.createRequire works with a file url with a space", () => {
  const path = join(import.meta.dir, "with space/hello.js");
  const require = Module.createRequire(new URL("./with space/nonexist.js", import.meta.url).toString());
  expect(require.resolve(import.meta.path)).toBe(import.meta.path);
  expect(require.resolve("./hello")).toBe(path);
  const { resolve } = require;
  expect(resolve("./hello")).toBe(path);
});

it("Module.createRequire does not use file url as the referrer (err message check)", () => {
  const require = Module.createRequire(import.meta.url);
  try {
    require("whaaat");
    expect.unreachable();
  } catch (e) {
    expect(e.name).not.toBe("UnreachableError");
    expect(e.message).not.toInclude("file:///");
    expect(e.message).toInclude(`'whaaat'`);
    expect(e.message).toInclude(import.meta.path);
  }
});

it("require with a query string works on dynamically created content", () => {
  rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
    recursive: true,
    force: true,
  });
  try {
    const require = Module.createRequire(tmpbase + "bun-test-import-meta-dynamic-dir/foo.js");
    try {
      require("./bar.js?query=123.js");
    } catch (e) {
      expect(e.name).toBe("ResolveMessage");
    }

    mkdirSync(tmpbase + "bun-test-import-meta-dynamic-dir", { recursive: true });

    writeFileSync(tmpbase + "bun-test-import-meta-dynamic-dir/bar.js", "export default 'hello';", "utf8");

    expect(require("./bar.js?query=123.js").default).toBe("hello");
  } catch (e) {
    throw e;
  } finally {
    rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
      recursive: true,
      force: true,
    });
  }
});

it("import.meta.require (json)", () => {
  expect(import.meta.require("./require-json.json").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-json").hello).toBe(sync.hello);
});

it("const f = require;require(json)", () => {
  function capture(f) {
    return f.length;
  }
  const f = require;
  capture(f);
  expect(f("./require-json.json").hello).toBe(sync.hello);
});

it("Module.createRequire().resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.path);
  const result = createdRequire.resolve("./require-json.json");

  expect(result).toBe(expected);
});

// this isn't used in bun but exists anyway
// we just want it to not be undefined
it("Module._cache", () => {
  const expected = typeof Module._cache === "object" && Module._cache;
  expect(!!expected).toBe(true);
});

it("Module._resolveFilename()", () => {
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
  const original = Module._resolveFilename;
  Module._resolveFilename = () => {};
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(true);
  Module._resolveFilename = original;
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
});

it("Module.createRequire(file://url).resolve(file://url)", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.url);
  const result1 = createdRequire.resolve("./require-json.json");
  const result2 = createdRequire.resolve(`file://${expected}`);
  expect(result1).toBe(expected);
  expect(result2).toBe(expected);
});

it("import.meta.require.resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);
  var { resolve } = import.meta.require;
  const result = resolve("./require-json.json");
  expect(result).toBe(expected);
});

it("import.meta.require (javascript)", () => {
  expect(import.meta.require("./require-js.js").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-js.js").hello).toBe(sync.hello);
});

it("import() require + TLA", async () => {
  expect((await import("./import-require-tla.js")).foo).toBe("bar");
});

it("import.meta.require (javascript, live bindings)", () => {
  var Source = import.meta.require("./import.live.decl.js");

  // require transpiles to import.meta.require
  var ReExport = require("./import.live.rexport.js");

  // dynamic require (string interpolation that way forces it to be dynamic)
  var ReExportDynamic = require(`./import.live.${"rexport".split("").join("")}.js`);

  expect(Source.foo).toBe(1);
  Source.setFoo(Source.foo + 1);

  expect(ReExport.foo).toBe(2);
  expect(Source.foo).toBe(2);
  expect(ReExportDynamic.foo).toBe(2);

  Source.setFoo(Source.foo + 1);

  var { Namespace } = require("./import.live.rexport-require.js");

  expect(Namespace).toBe(Source);
  expect(ReExport.foo).toBe(3);
  expect(Source.foo).toBe(3);
  expect(Namespace.foo).toBe(3);

  ReExport.setFoo(ReExport.foo + 1);

  expect(ReExport.foo).toBe(4);
  expect(Source.foo).toBe(4);
  expect(Namespace.foo).toBe(4);
});

it("import.meta.dir", () => {
  expect(dir).toEndWith(ospath("/test/js/bun/resolve"));
});

it("import.meta.dirname", () => {
  expect(dirname).toBe(dir);
});

it("import.meta.filename", () => {
  expect(filename).toBe(import.meta.path);
});

it("import.meta.path", () => {
  expect(path).toEndWith(ospath("/test/js/bun/resolve/import-meta.test.js"));
});

it('require("bun") works', () => {
  expect(require("bun")).toBe(Bun);
});

it('import("bun") works', async () => {
  expect(await import("bun")).toBe(Bun);
});

it("require.resolve with empty options object", () => {
  expect(require.resolve(import.meta.path + String(""), {})).toBe(import.meta.path);
});

it("dynamically import bun", async () => {
  expect((await import(eval("'bun'"))).default).toBe(Bun);
});

it("require.resolve error code", () => {
  try {
    require.resolve("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("MODULE_NOT_FOUND");
  }
});

it("import non exist error code", async () => {
  try {
    await import("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
  }
});

it("import non exist error code", async () => {
  try {
    await import("./idontexist");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
  }
});

it("import.meta paths have the correct slash", () => {
  const correct_sep = sep;
  const wrong_sep = correct_sep === "/" ? "\\" : "/";

  expect(import.meta.path).toInclude(correct_sep);
  expect(import.meta.path).not.toInclude(wrong_sep);
  expect(import.meta.dir).toInclude(correct_sep);
  expect(import.meta.dir).not.toInclude(wrong_sep);

  expect(import.meta.file).not.toInclude(sep);
  expect(import.meta.file).not.toInclude(sep);

  expect(import.meta.url).toStartWith("file:///");
  expect(import.meta.url).not.toInclude("\\");
});

it("import.meta is correct in a module that was imported with a query param", async () => {
  const esm = (await import("./other.js?foo=bar")).default;

  expect(esm.url).toBe(new URL("./other.js?foo=bar", import.meta.url).toString());
  expect(esm.path).toBe(join(import.meta.dir, "./other.js"));
  expect(esm.dir).toBe(import.meta.dir);
  expect(esm.file).toBe("other.js");
});

it("import.meta is correct in a module that was required with a query param", async () => {
  const cjs = require("./other-cjs.js?foo=bar").meta;
  expect(cjs.url).toBe(new URL("./other-cjs.js?foo=bar", import.meta.url).toString());
  expect(cjs.path).toBe(join(import.meta.dir, "./other-cjs.js"));
  expect(cjs.dir).toBe(import.meta.dir);
  expect(cjs.file).toBe("other-cjs.js");
});

it("import.meta of a collected module does not leak its url", async () => {
  // 200 module records with a 512 KB url each: 100 MiB when every one leaks.
  await expectRssDeltaBelow(["--smol", join(import.meta.dir, "import-meta-url-leak-fixture.mjs"), "200"], {
    release: 40,
    debug: 55,
  });
}, 90_000);

// `import.meta.resolve()` of a path or a file: URL returns the URL that the module loader loads the file under,
// which is its `import.meta.url`: the real path when the loader follows a symlink. What is not an existing file
// keeps the joined URL.
describe.concurrent("import.meta.resolve of an existing file", () => {
  const moduleSource = "export default import.meta.url;";

  async function run(root, args, spawnOptions = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-install", ...args],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ...spawnOptions,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let resolved = stdout;
    try {
      resolved = JSON.parse(stdout);
    } catch {}
    return { resolved, stderr, exitCode };
  }

  async function resolveAll(...flags) {
    using dir = tempDir("import-meta-resolve-symlink", {
      "real/m.mjs": moduleSource,
      "real/gone.mjs": moduleSource,
      "real/swapped.mjs": moduleSource,
      "real2/m.mjs": moduleSource,
      "[id].mjs": moduleSource,
      "node_modules/local-pkg/package.json": JSON.stringify({ name: "local-pkg", main: "index.js" }),
      "node_modules/local-pkg/index.js": "module.exports = 1;",
      "common.cjs": `module.exports = { resolved: import.meta.resolve("./ldir/m.mjs"), required: require.resolve("./ldir/m.mjs") };`,
      "main.mjs": `
        import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
        import { fileURLToPath } from "node:url";

        const linked = new URL("./ldir/m.mjs", import.meta.url);
        // The resolver now has "ldir/sub" cached as a directory that does not exist.
        await import("./ldir/sub/[x].mjs").catch(() => {});

        const resolved = {
          relative: import.meta.resolve("./ldir/m.mjs"),
          fileUrl: import.meta.resolve(linked.href),
          absolutePath: import.meta.resolve(fileURLToPath(linked)),
          parent: import.meta.resolve("./m.mjs", new URL("./ldir/parent.mjs", import.meta.url).href),
          queryAndHash: import.meta.resolve("./ldir/m.mjs?a=1#b"),
          imported: (await import("./ldir/m.mjs")).default,
          afterImport: import.meta.resolve("./ldir/m.mjs"),
          commonJs: (await import("./common.cjs")).default,
          fileLink: import.meta.resolve("./lfile.mjs"),
          fileLinkImported: (await import("./lfile.mjs").catch(() => ({}))).default,
          fileLinkOtherExtension: import.meta.resolve("./lfile.js"),
          fileLinkOtherExtensionImported: (await import("./lfile.js").catch(() => ({}))).default,
          brackets: import.meta.resolve("./[id].mjs"),
          bracketsImported: (await import("./[id].mjs")).default,
          fifo: import.meta.resolve("./ldir/fifo"),
          fifoLink: import.meta.resolve("./lfifo"),
          missing: import.meta.resolve("./ldir/missing.mjs"),
          danglingLink: import.meta.resolve("./ldir/dangling.mjs"),
          directory: import.meta.resolve("./ldir"),
          directorySlash: import.meta.resolve("./ldir/"),
          noExtension: import.meta.resolve("./ldir/m"),
          otherCase: import.meta.resolve("./ldir/M.MJS"),
          encodedSlash: import.meta.resolve("./ldir%2Fm.mjs"),
          encodedSlashLowerCase: import.meta.resolve("./ldir%2fm.mjs"),
          encodedBackslash: import.meta.resolve("./ldir%5Cm.mjs"),
          beforeMkdir: import.meta.resolve("./gen/a/x.mjs"),
        };
        if (process.platform !== "win32") {
          resolved.host = import.meta.resolve("file://otherhost" + linked.pathname);
          resolved.schemeRelativeHost = import.meta.resolve("//otherhost" + linked.pathname);
        }

        // The resolver has the listing of ldir cached by now, without this file.
        writeFileSync(new URL("./real/late.mjs", import.meta.url), ${JSON.stringify(moduleSource)});
        resolved.createdLate = import.meta.resolve("./ldir/late.mjs");
        resolved.createdLateImported = (await import("./ldir/late.mjs")).default;

        mkdirSync(new URL("./real/sub/", import.meta.url));
        writeFileSync(new URL("./real/sub/[x].mjs", import.meta.url), ${JSON.stringify(moduleSource)});
        resolved.inLateDirectory = import.meta.resolve("./ldir/sub/[x].mjs");
        resolved.inLateDirectoryImported = (await import("./ldir/sub/[x].mjs")).default;

        // The loader keeps the path that it loaded a file under. The file is not there any more.
        await import("./ldir/gone.mjs");
        rmSync(new URL("./real/gone.mjs", import.meta.url));
        resolved.deletedAfterImport = import.meta.resolve("./ldir/gone.mjs");
        await import("./ldir/swapped.mjs");
        rmSync(new URL("./real/swapped.mjs", import.meta.url));
        mkdirSync(new URL("./real/swapped.mjs/", import.meta.url));
        resolved.directoryAfterImport = import.meta.resolve("./ldir/swapped.mjs");

        if (process.platform !== "win32") {
          // The loader knows "cur" as a link to "real". Then "cur" becomes a link to "real2".
          await import("./cur/m.mjs");
          renameSync(new URL("./cur", import.meta.url), new URL("./old", import.meta.url));
          renameSync(new URL("./next", import.meta.url), new URL("./cur", import.meta.url));
          resolved.retargetedLink = import.meta.resolve("./cur/m.mjs");
          resolved.retargetedLinkImported = (await import("./cur/m.mjs")).default;
        }

        // "beforeMkdir" must not leave a trace in the resolver: a module in that directory still finds node_modules.
        mkdirSync(new URL("./gen/a/", import.meta.url), { recursive: true });
        writeFileSync(new URL("./gen/a/x.mjs", import.meta.url), "export default import.meta.resolve('local-pkg');");
        resolved.packageFromLateDirectory = (await import("./gen/a/x.mjs")).default;

        console.log(JSON.stringify(resolved));
      `,
    });
    const root = String(dir);
    symlinkSync(join(root, "real"), join(root, "ldir"), "junction");
    if (!isWindows) {
      symlinkSync("real", join(root, "cur"));
      symlinkSync("real2", join(root, "next"));
      // A file symlink needs a privilege on Windows.
      symlinkSync(join("real", "m.mjs"), join(root, "lfile.mjs"));
      symlinkSync(join("real", "m.mjs"), join(root, "lfile.js"));
      symlinkSync("nowhere.mjs", join(root, "real", "dangling.mjs"));
      mkfifo(join(root, "real", "fifo"));
      // Nothing writes to the pipe, so an open of it for reading blocks.
      symlinkSync(join("real", "fifo"), join(root, "lfifo"));
    }

    return {
      result: await run(root, [...flags, "main.mjs"]),
      path: (...parts) => join(root, ...parts),
      url: (...parts) => pathToFileURL(join(root, ...parts)).href,
      joined: specifier => new URL(specifier, pathToFileURL(join(root, "main.mjs"))).href,
      withHost: isWindows ? undefined : "file://otherhost" + pathToFileURL(join(root, "ldir", "m.mjs")).pathname,
      ignoresCase: existsSync(join(root, "REAL", "m.mjs")),
    };
  }

  it("returns the URL the module loads under", async () => {
    const { result, path, url, joined, withHost, ignoresCase } = await resolveAll();
    expect(result).toEqual({
      resolved: {
        relative: url("real", "m.mjs"),
        fileUrl: url("real", "m.mjs"),
        absolutePath: url("real", "m.mjs"),
        parent: url("real", "m.mjs"),
        queryAndHash: url("real", "m.mjs") + "?a=1#b",
        imported: url("real", "m.mjs"),
        afterImport: url("real", "m.mjs"),
        commonJs: { resolved: url("real", "m.mjs"), required: path("real", "m.mjs") },
        fileLink: isWindows ? joined("./lfile.mjs") : url("real", "m.mjs"),
        fileLinkImported: isWindows ? undefined : url("real", "m.mjs"),
        fileLinkOtherExtension: isWindows ? joined("./lfile.js") : url("real", "m.mjs"),
        fileLinkOtherExtensionImported: isWindows ? undefined : url("real", "m.mjs"),
        // The URL parser leaves "[" and "]" alone. A file URL made from a path escapes them.
        brackets: url("[id].mjs"),
        bracketsImported: url("[id].mjs"),
        // A directory listing does not have pipes, sockets and devices. The file system decides that they exist.
        fifo: isWindows ? joined("./ldir/fifo") : url("real", "fifo"),
        fifoLink: isWindows ? joined("./lfifo") : url("real", "fifo"),
        missing: joined("./ldir/missing.mjs"),
        danglingLink: joined("./ldir/dangling.mjs"),
        directory: joined("./ldir"),
        directorySlash: joined("./ldir/"),
        noExtension: joined("./ldir/m"),
        // The file name keeps its spelling, like in Node.js. The file exists only where the file system ignores case.
        otherCase: ignoresCase ? url("real", "M.MJS") : joined("./ldir/M.MJS"),
        // `fileURLToPath` rejects an encoded separator and a host. Such a URL must not become a local path.
        encodedSlash: joined("./ldir%2Fm.mjs"),
        encodedSlashLowerCase: joined("./ldir%2fm.mjs"),
        encodedBackslash: joined("./ldir%5Cm.mjs"),
        host: withHost,
        schemeRelativeHost: withHost,
        beforeMkdir: joined("./gen/a/x.mjs"),
        createdLate: url("real", "late.mjs"),
        createdLateImported: url("real", "late.mjs"),
        inLateDirectory: url("real", "sub", "[x].mjs"),
        inLateDirectoryImported: url("real", "sub", "[x].mjs"),
        deletedAfterImport: joined("./ldir/gone.mjs"),
        directoryAfterImport: joined("./ldir/swapped.mjs"),
        // The loader read the link once. The result is the path that it loads the module under.
        retargetedLink: isWindows ? undefined : url("real", "m.mjs"),
        retargetedLinkImported: isWindows ? undefined : url("real", "m.mjs"),
        packageFromLateDirectory: url("node_modules", "local-pkg", "index.js"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("keeps the joined URL with --preserve-symlinks", async () => {
    const { result, path, url, joined, withHost } = await resolveAll("--preserve-symlinks");
    expect(result).toEqual({
      resolved: {
        relative: joined("./ldir/m.mjs"),
        fileUrl: joined("./ldir/m.mjs"),
        absolutePath: joined("./ldir/m.mjs"),
        parent: joined("./ldir/m.mjs"),
        queryAndHash: joined("./ldir/m.mjs?a=1#b"),
        imported: joined("./ldir/m.mjs"),
        afterImport: joined("./ldir/m.mjs"),
        commonJs: { resolved: joined("./ldir/m.mjs"), required: path("ldir", "m.mjs") },
        fileLink: joined("./lfile.mjs"),
        // The resolver follows a file symlink also with this flag.
        fileLinkImported: isWindows ? undefined : url("real", "m.mjs"),
        fileLinkOtherExtension: joined("./lfile.js"),
        fileLinkOtherExtensionImported: isWindows ? undefined : url("real", "m.mjs"),
        brackets: joined("./[id].mjs"),
        bracketsImported: url("[id].mjs"),
        fifo: joined("./ldir/fifo"),
        fifoLink: joined("./lfifo"),
        missing: joined("./ldir/missing.mjs"),
        danglingLink: joined("./ldir/dangling.mjs"),
        directory: joined("./ldir"),
        directorySlash: joined("./ldir/"),
        noExtension: joined("./ldir/m"),
        otherCase: joined("./ldir/M.MJS"),
        encodedSlash: joined("./ldir%2Fm.mjs"),
        encodedSlashLowerCase: joined("./ldir%2fm.mjs"),
        encodedBackslash: joined("./ldir%5Cm.mjs"),
        host: withHost,
        schemeRelativeHost: withHost,
        beforeMkdir: joined("./gen/a/x.mjs"),
        createdLate: joined("./ldir/late.mjs"),
        createdLateImported: joined("./ldir/late.mjs"),
        inLateDirectory: joined("./ldir/sub/[x].mjs"),
        inLateDirectoryImported: url("ldir", "sub", "[x].mjs"),
        deletedAfterImport: joined("./ldir/gone.mjs"),
        directoryAfterImport: joined("./ldir/swapped.mjs"),
        retargetedLink: isWindows ? undefined : joined("./cur/m.mjs"),
        retargetedLinkImported: isWindows ? undefined : joined("./cur/m.mjs"),
        packageFromLateDirectory: url("node_modules", "local-pkg", "index.js"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Each state of the loader's caches runs in its own process. `import.meta.resolve(x)` before and after
  // `import(x)` is the URL that the module loads under, and `import(import.meta.resolve(x))` is that module.
  const identitySource = `
    import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { fileURLToPath } from "node:url";

    const at = path => fileURLToPath(new URL(path, import.meta.url));
    const states = {
      // The loader listed the directory before the link was there.
      async lateLink() {
        await import("./warm.mjs");
        symlinkSync(at("./real"), at("./late"), "junction");
        return "./late/m.mjs";
      },
      async lateFileLink() {
        await import("./warm.mjs");
        symlinkSync(at("./real/m.mjs"), at("./late.mjs"));
        return "./late.mjs";
      },
      // The loader listed the target of the link before the directory was there.
      async lateDirectoryBelowLink() {
        await import("./ldir/m.mjs");
        mkdirSync(at("./real/sub"));
        writeFileSync(at("./real/sub/m.mjs"), ${JSON.stringify(moduleSource)});
        return "./ldir/sub/m.mjs";
      },
      async temporaryDirectoryBelowLink() {
        await import("./ldir/m.mjs");
        const directory = mkdtempSync(at("./ldir/tmp-"));
        writeFileSync(join(directory, "m.mjs"), ${JSON.stringify(moduleSource)});
        return join(directory, "m.mjs");
      },
      // An import failed before the directories were there, so the loader has one of them cached as not found.
      async belowNotFoundDirectory() {
        await import("./ldir/gen/a/m.mjs").catch(() => {});
        mkdirSync(at("./real/gen/a"), { recursive: true });
        writeFileSync(at("./real/gen/a/m.mjs"), ${JSON.stringify(moduleSource)});
        return "./ldir/gen/a/m.mjs";
      },
      // The same, and then the loader reads the listing of the link again.
      async belowNotFoundDirectoryAfterRefresh() {
        await import("./ldir/m.mjs");
        await import("./ldir/gen/a/m.mjs").catch(() => {});
        mkdirSync(at("./real/gen/a"), { recursive: true });
        writeFileSync(at("./real/gen/a/m.mjs"), ${JSON.stringify(moduleSource)});
        writeFileSync(at("./real/late.mjs"), ${JSON.stringify(moduleSource)});
        await import("./ldir/late.mjs");
        return "./ldir/gen/a/m.mjs";
      },
      // The loader listed the directory when "swap" was a directory. Then "swap" became a link.
      async directoryBecameLink() {
        await import("./warm.mjs");
        renameSync(at("./swap"), at("./swap-old"));
        symlinkSync(at("./real"), at("./swap"), "junction");
        return "./swap/m.mjs";
      },
      // The loader listed the directory when "f.mjs" was a file. Then "f.mjs" became a link.
      async fileBecameLink() {
        await import("./warm.mjs");
        rmSync(at("./f.mjs"));
        symlinkSync(at("./real/m.mjs"), at("./f.mjs"));
        return "./f.mjs";
      },
      // The loader followed the link once. Then the link got another target, or became a directory.
      async fileLinkGotOtherTarget() {
        await import("./lfile.mjs");
        rmSync(at("./lfile.mjs"));
        symlinkSync(at("./swap/m.mjs"), at("./lfile.mjs"));
        return "./lfile.mjs";
      },
      async linkBecameDirectory() {
        await import("./ldir/m.mjs");
        rmSync(at("./ldir"));
        mkdirSync(at("./ldir"));
        writeFileSync(at("./ldir/m.mjs"), ${JSON.stringify(moduleSource)});
        return "./ldir/m.mjs";
      },
      // The file is behind a link in a directory that the loader cannot list.
      unlistableParent() {
        return process.argv[3];
      },
    };

    const specifier = await states[process.argv[2]]();
    const first = import.meta.resolve(specifier);
    const fromResolved = await import(first);
    const loaded = await import(specifier);
    console.log(
      JSON.stringify({
        first,
        loaded: loaded.default,
        second: import.meta.resolve(specifier),
        oneInstance: fromResolved === loaded,
      }),
    );
  `;

  function identityFixture() {
    return tempDir("import-meta-resolve-identity", {
      "real/m.mjs": moduleSource,
      "swap/m.mjs": moduleSource,
      "f.mjs": moduleSource,
      "warm.mjs": "export {};",
      "main.mjs": identitySource,
    });
  }

  function linkedIdentityFixture() {
    const dir = identityFixture();
    const root = String(dir);
    symlinkSync(join(root, "real"), join(root, "ldir"), "junction");
    if (!isWindows) symlinkSync(join("real", "m.mjs"), join(root, "lfile.mjs"));
    return dir;
  }

  // Node.js gives the real path in these states too.
  it.each(["lateLink", ...(isWindows ? [] : ["lateFileLink"]), "lateDirectoryBelowLink"])(
    "follows a link in the state %s",
    async state => {
      using dir = linkedIdentityFixture();
      const root = String(dir);
      const loaded = pathToFileURL(
        join(root, "real", ...(state === "lateDirectoryBelowLink" ? ["sub"] : []), "m.mjs"),
      ).href;
      expect(await run(root, ["main.mjs", state])).toEqual({
        resolved: { first: loaded, loaded, second: loaded, oneInstance: true },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The loader does not look at the file system again here. The result is still the URL that it loads the module under.
  it.each([
    "temporaryDirectoryBelowLink",
    "belowNotFoundDirectory",
    "belowNotFoundDirectoryAfterRefresh",
    "directoryBecameLink",
    "linkBecameDirectory",
    ...(isWindows ? [] : ["fileBecameLink", "fileLinkGotOtherTarget"]),
  ])("agrees with the loader in the state %s", async state => {
    using dir = linkedIdentityFixture();
    const root = String(dir);
    const result = await run(root, ["main.mjs", state]);
    const loaded = result.resolved.loaded;
    expect(result).toEqual({
      resolved: { first: loaded, loaded: expect.any(String), second: loaded, oneInstance: true },
      stderr: "",
      exitCode: 0,
    });
  });

  // `bun test` lists the directories below the working directory before a test runs.
  it.each(["a link that is new", "a link that was a directory"])(
    "agrees with the loader under bun test for %s",
    async state => {
      using dir = tempDir("import-meta-resolve-scanner", {
        "src/real/m.mjs": moduleSource,
        ...(state === "a link that was a directory" ? { "src/ldir/m.mjs": moduleSource } : {}),
        "identity.test.mjs": `
        import { test } from "bun:test";
        import { rmSync, symlinkSync } from "node:fs";
        import { join } from "node:path";

        test("identity", async () => {
          const link = join(import.meta.dirname, "src", "ldir");
          rmSync(link, { recursive: true, force: true });
          symlinkSync(join(import.meta.dirname, "src", "real"), link, "junction");

          const specifier = "./src/ldir/m.mjs";
          const first = import.meta.resolve(specifier);
          const fromResolved = await import(first);
          const loaded = await import(specifier);
          console.log(
            "identity:" +
              JSON.stringify({
                first,
                loaded: loaded.default,
                second: import.meta.resolve(specifier),
                oneInstance: fromResolved === loaded,
              }),
          );
        });
      `,
      });
      const { resolved: output, exitCode } = await run(String(dir), ["test", "identity.test.mjs"]);
      const identity = JSON.parse(/^identity:(.*)$/m.exec(output)?.[1] ?? null);
      expect({ identity, exitCode }).toEqual({
        identity: { first: identity?.loaded, loaded: expect.any(String), second: identity?.loaded, oneInstance: true },
        exitCode: 0,
      });
    },
  );

  it.skipIf(isWindows)("follows a link in a directory that it cannot list", async () => {
    using dir = tempDir("import-meta-resolve-unlistable", {
      "data/app/m.mjs": moduleSource,
      "shared/keep": "",
      "run/main.mjs": identitySource,
    });
    const root = String(dir);
    const shared = join(root, "shared");
    symlinkSync(join(root, "data", "app"), join(shared, "app"));
    using unprivileged = unprivilegedSpawnOptions(root);
    // The process can go through "shared", but it cannot list it.
    chmodSync(shared, 0o111);
    try {
      const loaded = pathToFileURL(join(root, "data", "app", "m.mjs")).href;
      expect(
        await run(join(root, "run"), ["main.mjs", "unlistableParent", join(shared, "app", "m.mjs")], unprivileged),
      ).toEqual({
        resolved: { first: loaded, loaded, second: loaded, oneInstance: true },
        stderr: "",
        exitCode: 0,
      });
    } finally {
      chmodSync(shared, 0o755);
    }
  });
});
