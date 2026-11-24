import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  promises as fs,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import {
  autoInstallTempDir,
  bunExe,
  bunRun,
  expectRssDeltaBelow,
  isASAN,
  isDebug,
  isLinux,
  isRoot,
  isWindows,
  tempDir,
} from "harness";
import { mkfifo } from "mkfifo";
import { availableParallelism } from "os";
import * as path from "path";
import { installEnv, TestRegistry, toml } from "registry";

// These tests verify that the resolver properly invalidates cache at runtime
// when using require() across file system changes within the same process.
// These test the same cache invalidation logic as the Bun.build tests but for runtime require().

describe.concurrent("runtime cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-index-js", {
      "subdir/index.js": `module.exports = { value: 42 };`,
    });

    const subdirPath = path.join(String(dir), "subdir");
    const requirePath = subdirPath;

    // Require 1: Should succeed
    const result1 = require(requirePath);
    expect(result1.value).toBe(42);

    // Clear require cache
    const resolvedPath = require.resolve(requirePath);
    delete require.cache[resolvedPath];

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(requirePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory with new content
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `module.exports = { value: 99 };`);

    // Require 3: Should succeed with new value
    const result3 = require(requirePath);
    expect(result3.value).toBe(99);
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-direct-file", {
      "config.js": `module.exports = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Require 1: Should succeed
    const result1 = require(configPath);
    expect(result1.version).toBe(1);

    // Clear require cache
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];

    // Delete file
    await fs.rm(configPath);

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(configPath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `module.exports = { version: 2 };`);

    // Require 3: Should succeed with new value
    const result3 = require(configPath);
    expect(result3.version).toBe(2);
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-nested", {
      "deep/nested/module.js": `module.exports = { value: "original" };`,
    });

    const modulePath = path.join(String(dir), "deep", "nested", "module.js");
    const deepPath = path.join(String(dir), "deep");

    // Require 1: Should succeed
    const result1 = require(modulePath);
    expect(result1.value).toBe("original");

    // Clear require cache
    delete require.cache[require.resolve(modulePath)];

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(modulePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `module.exports = { value: "recreated" };`);

    // Require 3: Should succeed
    const result3 = require(modulePath);
    expect(result3.value).toBe("recreated");
  });
});

const threadsAreSlow = isDebug || isASAN || !isLinux || availableParallelism() < 4;

/** A project without node_modules, and a registry that has version 1.0.0 of `packages`, each with `shipped` in it. */
async function projectThatInstalls(
  packages: Record<string, object>,
  files: Parameters<typeof tempDir>[1],
  shipped: Record<string, string> = {},
) {
  using owned = new DisposableStack();
  const dir = owned.use(autoInstallTempDir("runtime-cache-install", { "storage/.keep": "", "app": files }));
  for (const [name, fields] of Object.entries(packages)) {
    const manifest = { name, version: "1.0.0", ...fields };
    const packument = { name, "dist-tags": { latest: "1.0.0" }, "versions": { "1.0.0": { ...manifest, dist: {} } } };
    await Bun.write(path.join(dir, "storage", name, "package.json"), JSON.stringify(packument));
    await Bun.Archive.write(
      path.join(dir, "storage", name, `${name}-1.0.0.tgz`),
      { "package/package.json": JSON.stringify(manifest), "package/index.js": "", ...shipped },
      { compress: "gzip" },
    );
  }
  const registry = owned.use(new TestRegistry({ storage: path.join(dir, "storage"), recordRequests: true }).start());
  const at = (name: string) => path.join(dir, "app", name);
  writeFileSync(at("bunfig.toml"), toml({ install: { registry: registry.url } }));
  const flags = ["--cwd", at(".")];
  const env = installEnv(at("."));
  return Object.assign(owned.move(), {
    registry,
    at,
    flags,
    env,
    run: (...args: string[]) => bunRun([...flags, ...args], env),
    requests: () => registry.requests.map(it => it.path),
  });
}

describe.concurrent("a failed lookup does not keep a copy of what it read", () => {
  const long = Buffer.alloc(150, "-Long").toString();
  const longer = Buffer.alloc(250, "-Long").toString();
  const twins = Array.from({ length: 500 }, (_, i) => `${i < 250 ? "a" : "A"}${i % 250}${long}`);
  const deep = path.join("store", long, long, long, long, long);
  const files = Array.from({ length: 250 }, (_, i) => `File${i}${long}`);
  const links = Array.from({ length: 40 }, (_, i) => `link${i}.js`);
  const targets = Array.from({ length: 100 }, (_, i) => `./${i}${Buffer.alloc(4000, "/long")}.js`);
  const imports = Object.fromEntries(targets.map((target, i) => [`#${i}`, target]));
  const paths = Object.fromEntries(targets.map((target, i) => [i, [target]]));

  let dir: ReturnType<typeof tempDir>;
  beforeAll(() => {
    dir = tempDir("runtime-cache-miss-leak", {
      "node_modules/.keep": "",
      "files": {
        ...Object.fromEntries(files.map(name => [`${name}.js`, ""])),
        "found.js": "",
        "index.js": "",
        "src/.keep": "",
      },
      "package/package.json": JSON.stringify({ imports }),
      "tsconfig/tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { paths } }),
      "tsconfig/base.json": JSON.stringify({ extends: "@not/installed" }),
      "jsconfig/jsconfig.json": JSON.stringify({ extends: "@not/installed", compilerOptions: { paths } }),
      ...(!isWindows && { [path.join(deep, "target.js")]: "" }),
      "links/.keep": "",
      ...(isLinux && { cases: Object.fromEntries(twins.map(it => [it, ""])) }),
      "leak.mjs": `
        import { once } from "events";
        import { renameSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
        import { createRequire } from "module";
        import { dirname } from "path";
        import { Worker } from "worker_threads";
        const [how, rounds, importer, missing, ...found] = process.argv.slice(2);
        const require = createRequire(importer);
        const worker = how === "threads" && new Worker(import.meta.dir + "/worker.cjs", { workerData: [importer, missing] });
        const numbered = i => missing.replace(/missing$/, i + "missing");
        const lookUp = {
          require: async () => require(missing),
          numbered: async i => require(numbered(i)),
          import: () => import(missing),
          build: () => Bun.build({ entrypoints: [missing] }),
          buildNumbered: i => Bun.build({ entrypoints: [numbered(i)] }),
          // The second lookup finds it.
          async create(i) {
            writeFileSync(missing + i, "");
            unlinkSync(require.resolve(missing + i));
            require(missing);
          },
          async move() {
            const folder = dirname(importer);
            renameSync(folder, folder + "~");
            try { Bun.resolveSync(folder + "/missing", import.meta.dir); } catch {}
            renameSync(folder + "~", folder);
            require(missing);
          },
          async replace() {
            const folder = dirname(found.length ? require.resolve(found[0]) : importer);
            renameSync(folder, folder + "~");
            for (const put of [() => symlinkSync(folder, folder), () => writeFileSync(folder, "")]) {
              put();
              for (const from of [import.meta.dir, import.meta.dir, folder]) {
                try { Bun.resolveSync(folder + "/missing", from); } catch {}
              }
              unlinkSync(folder);
            }
            renameSync(folder + "~", folder);
            require(missing);
          },
          async rebuild() {
            const folder = dirname(importer);
            renameSync(folder, folder + "~");
            try { Bun.resolveSync(folder + "/found", import.meta.dir); } catch {}
            renameSync(folder + "~", folder);
            await Bun.build({ entrypoints: [folder + ".js"] });
            require(missing);
          },
          async threads() {
            worker.postMessage(0);
            await once(worker, "message");
            require(missing);
          },
          installed: async () => require(dirname(require.resolve(found[0])) + missing),
          // The second try does not read the directory of the package.
          async plugin() {
            createRequire(require.resolve(found[0])).resolve(missing, { paths: [import.meta.dir] });
          },
        }[how];
        let lookups = 0;
        async function rssAfter(rounds) {
          for (let i = 0; i < rounds; i++) {
            const error = await lookUp(lookups++).catch(error => error.errors?.[0] ?? error);
            if (!error?.message.includes("missing'") && !error?.message.includes('missing"')) throw error;
            for (const specifier of found) require.resolve(specifier);
          }
          Bun.gc(true);
          return process.memoryUsage.rss();
        }
        // Grow the heap for the errors where a lookup is cheap.
        for (let i = 0; i < 400; i++) try { require(import.meta.dir + "/node_modules/missing"); } catch {}
        const before = await rssAfter(10);
        console.log(JSON.stringify({ deltaMiB: ((await rssAfter(rounds)) - before) / 1024 / 1024 }));
        if (worker) worker.terminate();
      `,
      "quiet.toml": `logLevel = "error"`,
      "other.json": "{}",
      "rebuilt.js": `import "./rebuilt/found.js";`,
      ...(!isWindows && {
        rebuilt: Object.fromEntries(
          ["found.js", ...Array.from({ length: 1000 }, (_, i) => i + longer)].map(it => [it, ""]),
        ),
      }),
      "worker.cjs": `
        const { parentPort, workerData: [importer, missing] } = require("worker_threads");
        parentPort.on("message", () => {
          try { require("module").createRequire(importer)(missing); } catch {}
          parentPort.postMessage(0);
        });
      `,
    });
    for (const copy of ["created", ...(isWindows ? [] : ["moved", "path", "name"])]) {
      cpSync(path.join(dir, "files"), path.join(dir, copy), { recursive: true });
    }
    symlinkSync("found.js", path.join(dir, "files/link.js"));
    symlinkSync("removed.js", path.join(dir, "files/dangling-missing"));
    symlinkSync(path.join(dir, "files"), path.join(dir, "linked"), "junction");
    if (isWindows) return;
    for (const link of links) symlinkSync(path.join("..", deep, "target.js"), path.join(dir, "links", link));
  });
  afterAll(() => dir[Symbol.dispose]());

  // With a copy for each lookup, these grow by 40 MiB or more, and by 23 MiB or more in the rounds of a slow build.
  const run = (how: string, rounds: number, importer: string, ...specifiers: string[]) =>
    runWith({}, how, rounds, importer, ...specifiers);
  const runWith = (
    { flags = [], env }: { flags?: string[]; env?: NodeJS.Dict<string> },
    how: string,
    rounds: number,
    importer: string,
    ...specifiers: string[]
  ) =>
    expectRssDeltaBelow(
      [
        ...flags,
        path.join(dir, "leak.mjs"),
        how,
        String(isDebug || isASAN ? rounds * 0.4 : rounds),
        path.resolve(dir, importer),
        ...specifiers.map(it => it.replace("<dir>", dir)),
      ],
      { release: 15, debug: 12 },
      env,
    );

  test.each([
    ["require", "files/src/a.js", "<dir>/files/src/../"],
    ["require", "files/src/a.js", "<dir>/files/./"],
    ["require", "files/src/a.js", "<dir>/files//"],
    ["require", "files/src/a.js", "<dir>/files/"],
    ["require", "files/src/a.js", "../"],
    ["require", "files/a.js", "./"],
    ["require", "a.js", "./linked/"],
    ["require", "a.js", "<dir>/linked/src/../"],
    ["import", "a.js", "<dir>/files/src/../"],
  ])("%s from %s of %smissing", (how, importer, prefix) =>
    run(how, 300, importer, ...["missing", "found.js", "found", "link.js", ""].map(name => prefix + name)),
  );

  test("Bun.build of an entry point", () => run("build", 150, "a.js", "<dir>/files/./missing", "<dir>/files/./found"));
  test("require with --preserve-symlinks", () =>
    runWith({ flags: ["--preserve-symlinks"] }, "require", 300, "a.js", "./linked/missing", "./linked/found.js"));
  test("require once a package was looked for in the registry", async () => {
    using project = await projectThatInstalls(
      {},
      { "package.json": JSON.stringify({ imports }), "preload.js": `try { require("absent"); } catch {}` },
    );
    project.flags.push("--preload", "./preload.js");
    await runWith(project, "require", 150, project.at("a.js"), "#missing");
    expect(project.requests()).toEqual(["/absent"]);
  });
  test.each([
    ["installed", "/missing", "a directory"],
    ["installed", "/missing", "a link"],
    ["plugin", "missing", "a directory"],
  ])("a package that was installed on import (%s, %s, the cache is %s)", async (how, missing, cache) => {
    using project = await projectThatInstalls({ pkg: { imports } }, { "package.json": "{}", "real/.keep": "" });
    if (cache === "a link") symlinkSync(project.at("real"), project.env.BUN_INSTALL_CACHE_DIR, "junction");
    await runWith(project, how, 150, project.at("a.js"), missing, "pkg");
    expect(project.requests()).toEqual(["/pkg", "/pkg/-/pkg-1.0.0.tgz"]);
  });
  test.skipIf(isWindows /* no /dev/fd */)("nor a descriptor of a package that was installed on import", async () => {
    using project = await projectThatInstalls(
      { pkg: {} },
      {
        "package.json": "{}",
        "a.js": `
          // The package is reached by its path after the first failure, and by its name after the second.
          function round() {
            const folder = require("path").dirname(require.resolve("pkg"));
            for (const name of ["/missing", "/index.js", "/missing"]) try { require.resolve(folder + name); } catch {}
            return require("fs").readdirSync("/dev/fd").length;
          }
          const before = round();
          for (let i = 0; i < 20; i++) round();
          console.log(round() < before + 10);
        `,
      },
    );
    expect(await project.run("a.js")).toSpawn("true");
  });
  test("require on the main thread and in a worker", () => run("threads", 150, "package/a.js", "missing"));
  describe.skipIf(isWindows /* a scanner can have a file in it open */)("a directory is moved away and back", () => {
    test("between lookups", () => run("move", 300, "moved/a.js", "missing"));
    test.each([
      ["path", "./missing"],
      ["name", "missing"],
    ])("with a link to itself, then a file in its place, before a lookup by %s", (folder, missing) =>
      run("replace", 300, `${folder}/a.js`, missing),
    );
    test("the same for a package that was installed on import", async () => {
      using project = await projectThatInstalls({ pkg: { imports } }, { "package.json": "{}" });
      await runWith(project, "replace", 150, project.at("a.js"), "./missing", "pkg");
      expect(project.requests()).toEqual(["/pkg", "/pkg/-/pkg-1.0.0.tgz"]);
    });
    test("before a build", () => run("rebuild", 60, "rebuilt/a.js", "./missing"));
  });
  test("require of a package", () => run("require", 300, "files/a.js", "missing"));
  test("require of a new name each time", () => run("numbered", 150, "a.js", "./package/missing"));
  test("require of a dangling link", () => run("require", 300, "files/a.js", "./dangling-missing"));
  test("require of a file that was just made", () => run("create", 150, "a.js", "<dir>/created/missing"));
  test.each(["package", "tsconfig", "jsconfig"])("next to a %s.json", name =>
    run("require", 150, `${name}/a.js`, "missing"),
  );

  describe(`with logLevel = "error"`, () => {
    const quiet = () => `--config=${path.join(dir, "quiet.toml")}`;
    test("Bun.build next to a package.json", () =>
      runWith({ flags: [quiet()] }, "buildNumbered", 75, "a.js", "<dir>/package/missing"));
    test("require next to a tsconfig.json that is overridden", () => {
      const flags = [quiet(), `--tsconfig-override=${path.join(dir, "other.json")}`];
      return runWith({ flags }, "require", 150, "tsconfig/a.js", "missing");
    });
  });
  test.skipIf(!isLinux /* needs a case-sensitive file system */)("next to names that differ only in case", () =>
    run("require", 300, "cases/a.js", "./missing"),
  );

  describe.skipIf(isDebug || isASAN || isWindows /* 40,000 lookups or more */)("next to", () => {
    test("links that are used", () => run("require", 1000, "links/a.js", "./missing", ...links.map(it => `./${it}`)));
    test.each(["", ".js"])("files that are imported as name%s", extension =>
      run("require", 200, "a.js", "<dir>/files/./missing", ...files.map(it => `<dir>/files/./${it}${extension}`)),
    );
  });
});

describe.concurrent("after a failed lookup, the next one sees what has changed", () => {
  function project(files: Parameters<typeof tempDir>[1]) {
    // With a node_modules folder above the importer, nothing is installed.
    const dir = tempDir("runtime-cache-after-miss", { "node_modules/.keep": "", "app": files });
    const at = (name: string) => path.join(dir, "app", name);
    const resolve = (specifier: string, from = ".") => {
      try {
        return path.relative(at("."), Bun.resolveSync(specifier, at(from))).replaceAll(path.sep, "/");
      } catch {
        return null;
      }
    };
    return {
      [Symbol.dispose]: () => dir[Symbol.dispose](),
      at,
      resolve,
      missIn: (folder: string) => expect(resolve(`./${folder}/missing`)).toBeNull(),
      write(name: string, contents: string | object = "") {
        mkdirSync(path.dirname(at(name)), { recursive: true });
        writeFileSync(at(name), typeof contents === "string" ? contents : JSON.stringify(contents));
      },
      remove: (name: string) => rmSync(at(name), { recursive: true }),
      link(name: string, target: string, type: "file" | "junction" = "file") {
        rmSync(at(name), { recursive: true, force: true });
        symlinkSync(at(target), at(name), type);
      },
      /** It reads the directories that it goes through again, into the listings that are cached. */
      async build(entry: string, target: Bun.Target = "bun") {
        const { success, outputs } = await Bun.build({ entrypoints: [at(entry)], target, throw: false });
        return success ? await outputs[0].text() : null;
      },
    };
  }

  test("a file is added", () => {
    using p = project({ "a.js": "" });
    expect(p.resolve("./b")).toBeNull();
    p.write("b.js");
    expect(p.resolve("./b")).toBe("b.js");
  });

  test("a file is removed", () => {
    using p = project({ "a.ts": "", "a.js": "" });
    expect(p.resolve("./a")).toBe("a.ts");
    p.remove("a.ts");
    p.missIn(".");
    expect(p.resolve("./a")).toBe("a.js");
  });

  test("a file is renamed to another case", () => {
    using p = project({ "a.js": "" });
    p.missIn(".");
    renameSync(p.at("a.js"), p.at("A.js"));
    p.missIn(".");
    expect(p.resolve("./A.js")).toBe("A.js");
  });

  test.skipIf(!isLinux /* needs a case-sensitive file system */).each([0, 1])(
    "a file gets a neighbor whose name differs only in case (%d)",
    index => {
      using p = project({ "a.js": "" });
      p.write("A.js");
      const added = readdirSync(p.at("."))[index];
      p.remove(added);
      p.missIn(".");
      p.write(added);
      p.missIn(".");
      // They share an entry of the listing.
      expect(p.resolve(`./${added}`)).toBe(readdirSync(p.at(".")).at(-1)!);
    },
  );

  test.skipIf(!isLinux /* the same */)("a file is renamed to another case next to such neighbors", () => {
    using p = project({ "a.js": "", "a.json": "", "b.js": "" });
    p.write("B.js");
    p.missIn(".");
    renameSync(p.at("a.js"), p.at("A.js"));
    p.missIn(".");
    expect(p.resolve("./A")).toBe("A.js");
  });

  test.skipIf(!isLinux /* the same */)("the last of two names that differ only in case becomes a pipe", () => {
    using p = project({ "a.js": "" });
    p.write("A.js");
    const [first, last] = readdirSync(p.at("."));
    p.missIn(".");
    p.remove(last);
    mkfifo(p.at(last));
    // A lookup that fails reads the directory again, so it has to find something else.
    p.write("a.json");
    p.missIn(".");
    expect(p.resolve(`./${path.parse(first).name}`)).toBe(first);
  });

  test("a file is renamed to another case, and an index file is added", () => {
    using p = project({ "lib/a.js": "" });
    expect(p.resolve("./lib")).toBeNull();
    renameSync(p.at("lib/a.js"), p.at("lib/A.js"));
    p.write("lib/index.js");
    p.missIn("lib");
    expect(p.resolve("./lib")).toBe("lib/index.js");
  });

  test("a file was imported with another case", () => {
    using p = project({ "a.js": "" });
    p.resolve("./A");
    p.missIn(".");
    expect(p.resolve("./a")).toBe("a.js");
  });

  test("a file becomes a directory", () => {
    using p = project({ "a": "" });
    expect(p.resolve("./a")).toBe("a");
    expect(p.resolve("./a/b")).toBeNull();
    p.remove("a");
    p.write("a/index.js");
    p.write("a/b.js");
    expect(p.resolve("./a/b")).toBe("a/b.js");
    p.missIn(".");
    expect(p.resolve("./a")).toBe("a/index.js");
  });

  test("a dangling link gets its target", () => {
    using p = project({ "real/.keep": "" });
    p.link("a.js", "real/a.js");
    expect(p.resolve("./a.js")).toBeNull();
    p.write("real/a.js");
    expect(p.resolve("./a.js")).toBe("real/a.js");
  });

  test.each(["before", "after"])("a link is moved %s the failed lookup", when => {
    using p = project({ "v1/a.js": "", "v2/a.js": "" });
    p.link("a.js", "v1/a.js");
    expect(p.resolve("./a.js")).toBe("v1/a.js");
    if (when === "after") p.missIn(".");
    p.link("a.js", "v2/a.js");
    if (when === "before") p.missIn(".");
    expect(p.resolve("./a.js")).toBe("v2/a.js");
  });

  test.each(["before", "after"])("a link to a directory is moved %s the failed lookups", when => {
    using p = project({ "v1/a.js": "", "v1/b/c.js": "", "v2/a.js": "", "v2/b/c.js": "" });
    const missEverywhere = () => [".", "current", "current/b"].forEach(p.missIn);
    p.link("current", "v1", "junction");
    expect([p.resolve("./current/a.js"), p.resolve("./current/b/c.js")]).toEqual(["v1/a.js", "v1/b/c.js"]);
    if (when === "after") missEverywhere();
    p.link("current", "v2", "junction");
    if (when === "before") missEverywhere();
    expect([p.resolve("./current/a.js"), p.resolve("./current/b/c.js")]).toEqual(["v2/a.js", "v2/b/c.js"]);
  });

  test.skipIf(isWindows || isRoot /* needs a directory that cannot be listed */)(
    "a link to a directory is moved, and the directory could not be listed in between",
    async () => {
      using p = project({ "v1/a.js": "", "v1/b/c.js": "", "v2/a.js": "", "a.js": `import "./current/a.js";` });
      p.link("current", "v1");
      expect(p.resolve("./current/a.js")).toBe("v1/a.js");
      // The second try looks in node_modules, so the directory is not read again.
      expect(p.resolve("current/missing")).toBeNull();
      chmodSync(p.at("v1"), 0o111);
      const below = p.resolve("./c.js", "current/b");
      chmodSync(p.at("v1"), 0o755);
      expect(below).toBe("current/b/c.js");
      p.remove("current");
      expect(await p.build("a.js")).toBeNull();
      p.link("current", "v2");
      p.missIn(".");
      expect(p.resolve("./current/a.js")).toBe("v2/a.js");
    },
  );

  test("a link to a directory is removed, a build fails on it, and a FileSystemRouter reloads", async () => {
    using p = project({ "v1/a.js": "", "v2/a.js": "", "a.js": `import "./current/a.js";` });
    p.link("current", "v1", "junction");
    const router = new Bun.FileSystemRouter({ dir: p.at("."), style: "nextjs", fileExtensions: [".none"] });
    expect(p.resolve("./current/a.js")).toBe("v1/a.js");
    p.remove("current");
    expect(await p.build("a.js")).toBeNull();
    p.link("current", "v2", "junction");
    p.missIn(".");
    router.reload();
    expect(p.resolve("./current/a.js")).toBe("v2/a.js");
  });

  test("a link to a directory becomes a directory", () => {
    using p = project({ "real/a.js": "" });
    p.link("lib", "real", "junction");
    expect(p.resolve("./lib/a.js")).toBe("real/a.js");
    p.remove("lib");
    p.write("lib/a.js");
    [".", "lib"].forEach(p.missIn);
    expect(p.resolve("./lib/a.js")).toBe("lib/a.js");
  });

  test.skipIf(isWindows /* another error */)("a directory cannot be read for another reason", async () => {
    using p = project({ "a.js": `import "./lib/b.js";` });
    const errors = async () => (await Bun.build({ entrypoints: [p.at("a.js")], throw: false })).logs.join();
    p.link("lib", "lib");
    expect(await errors()).toContain("ELOOP");
    p.remove("lib");
    p.write("lib");
    p.missIn("lib");
    expect(await errors()).not.toContain("ELOOP");
  });

  test.each(["lookups", "builds"])("a link to a directory is moved, and %s found a file in between", async what => {
    using p = project({
      "v1/a.js": `console.log("v1");`,
      "v2/a.js": `console.log("v2");`,
      "a.js": `import "./current/a.js";`,
    });
    const fail = async () => (what === "builds" ? expect(await p.build("a.js")).toBeNull() : p.missIn("current"));
    p.link("current", "v1", "junction");
    expect(p.resolve("./current/a.js")).toBe("v1/a.js");
    p.remove("current");
    await fail();
    p.write("current");
    await fail();
    p.link("current", "v2", "junction");
    p.missIn(".");
    expect(await p.build("current/a.js")).toContain(`console.log("v2")`);
    expect(p.resolve("./current/a.js")).toBe("v2/a.js");
  });

  test("a link becomes a file", () => {
    using p = project({ "real/a.js": "" });
    p.link("a.js", "real/a.js");
    expect(p.resolve("./a.js")).toBe("real/a.js");
    p.remove("a.js");
    p.write("a.js");
    p.missIn(".");
    expect(p.resolve("./a.js")).toBe("a.js");
  });

  test("a file becomes a link, a build follows it, and it becomes a file again", async () => {
    using p = project({ "real/a.js": "", "a.js": "" });
    expect(p.resolve("./a.js")).toBe("a.js");
    p.link("a.js", "real/a.js");
    expect(await p.build("a.js")).toBeString();
    expect(p.resolve("./a.js")).toBe("real/a.js");
    p.remove("a.js");
    p.write("a.js");
    p.missIn(".");
    expect(p.resolve("./a.js")).toBe("a.js");
  });

  test("a link is removed", () => {
    using p = project({ "real/a.js": "" });
    p.link("a.js", "real/a.js");
    expect(p.resolve("./a.js")).toBe("real/a.js");
    p.missIn(".");
    p.remove("a.js");
    // The listing still has the name.
    expect(p.resolve("./a.js")).toBe("a.js");
  });

  test("a link that a FileSystemRouter has followed is moved", () => {
    using p = project({ "v1/a.js": "", "v2/a.js": "", "pages/.keep": "" });
    p.link("pages/a.js", "v1/a.js");
    const { routes } = new Bun.FileSystemRouter({ dir: p.at("pages"), style: "nextjs" });
    expect(path.normalize(routes["/a"])).toBe(p.at("v1/a.js"));
    p.link("pages/a.js", "v2/a.js");
    p.missIn("pages");
    expect(p.resolve("./pages/a.js")).toBe("v2/a.js");
  });

  test("a FileSystemRouter is made for the directory", () => {
    using p = project({ "pages/a.js": "" });
    p.missIn("pages");
    const router = new Bun.FileSystemRouter({ dir: p.at("pages"), style: "nextjs" });
    router.reload();
    expect(Object.keys(router.routes)).toEqual(["/a"]);
  });

  test("node_modules is made in the parent directory", () => {
    using p = project({ "src/a.js": "" });
    expect(p.resolve("pkg", "src")).toBeNull();
    p.write("node_modules/pkg/index.js");
    p.missIn(".");
    expect(p.resolve("pkg", "src")).toBe("node_modules/pkg/index.js");
  });

  test("package.json is edited", () => {
    using p = project({ "package.json": `{ "imports": { "#a": "./a.js" } }`, "a.js": "" });
    expect(p.resolve("#b")).toBeNull();
    p.write("package.json", `{ "imports": { "#b": "./a.js" } }`);
    expect(p.resolve("#b")).toBe("a.js");
  });

  test.skipIf(isWindows /* no mkfifo */)("package.json becomes a pipe", async () => {
    using p = project({
      "lib": { "package.json": "{}", "a.js": "" },
      "a.js": `
        require.resolve("./lib/a.js");
        require("fs").renameSync(__dirname + "/pipe", __dirname + "/lib/package.json");
        try { require.resolve("./lib/missing"); } catch {}
        console.log(require.resolve("./lib/a.js"));
      `,
    });
    mkfifo(p.at("pipe"));
    expect(await bunRun(p.at("a.js"))).toSpawn(p.at("lib/a.js"));
  });

  test("a worker, which does not install, has read package.json", async () => {
    using p = await projectThatInstalls(
      { pkg: {} },
      {
        "lib/package.json": `{ "dependencies": { "alias": "npm:pkg@1.0.0" } }`,
        "lib/a.js": "",
        "a.js": `
          const { Worker, isMainThread } = require("worker_threads");
          if (!isMainThread) require("./lib/a.js");
          else new Worker(__filename).on("exit", () => console.log(typeof Bun.resolveSync("alias", __dirname + "/lib")));
        `,
      },
    );
    expect(await p.run("a.js")).toSpawn("string");
    expect(p.requests()).toEqual(["/alias", "/pkg", "/pkg/-/pkg-1.0.0.tgz"]);
  });

  test("package.json was read before the lockfile, which has a peer that the registry has lost", async () => {
    using p = await projectThatInstalls(
      { pkg: { peerDependencies: { peer: "1.0.0" } }, peer: {} },
      {
        "package.json": `{ "dependencies": { "pkg": "1.0.0" } }`,
        "a.js": `console.log(typeof Bun.resolveSync("peer", require("path").dirname(require.resolve("pkg"))));`,
      },
    );
    await $`${bunExe()} install --linker=hoisted`.cwd(p.at(".")).env(p.env).quiet();
    rmSync(p.at("node_modules/peer"), { recursive: true });
    for (const manifest of new Bun.Glob("*.npm").scanSync({ cwd: p.env.BUN_INSTALL_CACHE_DIR, absolute: true })) {
      rmSync(manifest);
    }
    p.registry.packages.delete("peer");
    expect(await p.run("--install=fallback", "a.js")).toSpawn("string");
    expect(p.requests().at(-1)).toBe("/peer");
  });

  const quietly = `const resolve = (specifier, from) => { try { return Bun.resolveSync(specifier, from); } catch {} };`;

  test("package.json was read before another install added the package to the lockfile", async () => {
    const pkg = { peerDependencies: { peer: "npm:real@1.0.0" } };
    using p = await projectThatInstalls(
      { pkg, real: {}, other: { dependencies: { pkg: "1.0.0" } } },
      {
        "package.json": "{}",
        "node_modules/pkg": {
          "package.json": JSON.stringify({ name: "pkg", version: "1.0.0", ...pkg }),
          "index.js": "",
        },
        "a.js": `
          ${quietly}
          resolve("absent", __dirname);
          resolve("pkg", __dirname);
          resolve("pkg", require("path").dirname(resolve("other", __dirname)));
          console.log(typeof resolve("peer", __dirname + "/node_modules/pkg"));
        `,
      },
    );
    expect(await p.run("--install=fallback", "a.js")).toSpawn("string");
  });

  /** The folder of `pkg` in the cache, from another process. */
  async function install(p: Awaited<ReturnType<typeof projectThatInstalls>>) {
    writeFileSync(p.at("install.js"), `console.log(require.resolve("pkg"));`);
    const result = await p.run("--install=fallback", "install.js");
    expect(result).toSpawn();
    return path.dirname(result.stdout);
  }
  const byPathThenByName = `resolve("./index.js", pkg), resolve("./missing", pkg), resolve("pkg", __dirname);`;

  test("an installed package needs what the registry does not have, and a folder above the cache does", async () => {
    using p = await projectThatInstalls(
      { pkg: {} },
      {
        "package.json": "{}",
        "node_modules/private/index.js": "",
        "a.js": `
          ${quietly}
          const pkg = process.argv[2];
          resolve("absent", __dirname);
          resolve("private", pkg);
          ${byPathThenByName}
          console.log(resolve("private", pkg));
        `,
      },
    );
    expect(await p.run("--install=fallback", "a.js", await install(p))).toSpawn(p.at("node_modules/private/index.js"));
  });

  test("an installed package is reached by its path, then by its name, and does not look above the cache", async () => {
    using p = await projectThatInstalls(
      { pkg: { dependencies: { dependency: "1.0.0" } }, dependency: {} },
      {
        "package.json": "{}",
        ".bun-cache/node_modules/.keep": "",
        "a.js": `
          ${quietly}
          const pkg = require("path").dirname(resolve("pkg", __dirname));
          resolve("./missing", pkg);
          ${byPathThenByName}
          console.log(typeof resolve("dependency", pkg));
        `,
      },
    );
    expect(await p.run("a.js")).toSpawn("string");
  });

  test("the same for a package that ships node_modules, and the cache was looked for before it was made", async () => {
    using p = await projectThatInstalls(
      { pkg: { dependencies: { dependency: "1.0.0" } }, dependency: {}, other: {} },
      {
        "package.json": "{}",
        "a.js": `
          ${quietly}
          console.log(require("fs").existsSync(process.env.BUN_INSTALL_CACHE_DIR));
          resolve("./.bun-cache", __dirname);
          const pkg = require("path").dirname(resolve("pkg", __dirname));
          resolve("./missing", pkg);
          resolve("other", __dirname);
          ${byPathThenByName}
          console.log(typeof resolve("dependency", pkg));
        `,
      },
      { "package/node_modules/bundled/index.js": "" },
    );
    expect(await p.run("a.js")).toSpawn("false\nstring");
  });

  test.skipIf(isWindows /* the cache is open */)("the link to the cache of installed packages is moved", async () => {
    using p = await projectThatInstalls(
      { pkg: {} },
      {
        "package.json": "{}",
        "v1/.keep": "",
        "a.js": `
          ${quietly}
          const fs = require("fs");
          for (const specifier of ["./index.js", "./missing"]) resolve(specifier, process.argv[2]);
          fs.renameSync(__dirname + "/v1", __dirname + "/v2");
          fs.unlinkSync(process.env.BUN_INSTALL_CACHE_DIR);
          fs.symlinkSync("v2", process.env.BUN_INSTALL_CACHE_DIR);
          console.log(fs.existsSync(resolve("pkg", __dirname)));
        `,
      },
    );
    symlinkSync("v1", p.env.BUN_INSTALL_CACHE_DIR);
    expect(await p.run("a.js", await install(p))).toSpawn("true");
  });

  test.skipIf(isWindows /* the same */)(
    "the same, after workers used the path while the name was looked up",
    async () => {
      using p = await projectThatInstalls(
        { pkg: {} },
        {
          "package.json": "{}",
          "v0/.keep": "",
          "a.js": `
          ${quietly}
          const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
          const fs = require("fs"), { once } = require("events");
          async function main() {
            const cache = process.env.BUN_INSTALL_CACHE_DIR;
            const pkg = require("path").dirname(resolve("pkg", __dirname));
            const stop = new Int32Array(new SharedArrayBuffer(4));
            const workers = Array.from({ length: 3 }, () => new Worker(__filename, { workerData: [pkg, stop] }));
            const answers = () => Promise.all(workers.map(worker => once(worker, "message")));
            let wrong = 0;
            for (let i = 0; i < ${threadsAreSlow ? 20 : 100}; i++) {
              Atomics.store(stop, 0, 0);
              workers.forEach(worker => worker.postMessage(0));
              await answers();
              for (let k = 0; k < 6; k++) resolve("./missing", pkg), resolve("pkg", __dirname);
              Atomics.store(stop, 0, 1);
              await answers();
              fs.renameSync("v" + i, "v" + (i + 1));
              fs.unlinkSync(cache);
              fs.symlinkSync("v" + (i + 1), cache);
              for (const folder of [__dirname, cache, pkg]) resolve("./missing", folder);
              if (!fs.existsSync(resolve("pkg", __dirname))) wrong++;
            }
            console.log(wrong);
            workers.forEach(worker => worker.terminate());
          }
          if (isMainThread) main();
          else
            parentPort.on("message", () => {
              parentPort.postMessage("started");
              while (!Atomics.load(workerData[1], 0)) resolve("./index.js", workerData[0]);
              parentPort.postMessage("stopped");
            });
        `,
        },
      );
      symlinkSync("v0", p.env.BUN_INSTALL_CACHE_DIR);
      expect(await p.run("a.js")).toSpawn("0");
    },
  );

  test.skipIf(isWindows /* it cannot be moved */)("the working directory, which stays open, is replaced", async () => {
    using p = await projectThatInstalls(
      {},
      {
        "package.json": "{}",
        "lib": { "package.json": `{ "imports": { "#a": "./a.js" } }`, "a.js": "" },
        "next": { "package.json": `{ "imports": { "#a": "./b.js" } }`, "a.js": "", "b.js": "", "src/.keep": "" },
        "a.js": `
          ${quietly}
          process.chdir("lib");
          resolve("absent", __dirname);
          resolve("#a", __dirname + "/lib");
          require("fs").renameSync(__dirname + "/lib", __dirname + "/old");
          require("fs").renameSync(__dirname + "/next", __dirname + "/lib");
          resolve("./lib/missing", __dirname);
          console.log(resolve("#a", __dirname + "/lib/src"));
        `,
      },
    );
    expect(await p.run("a.js")).toSpawn(p.at("lib/b.js"));
  });

  const alias = (name: string) => ({ compilerOptions: { paths: { [name]: ["./a.js"] } } });
  test.each([
    ["tsconfig.json is edited", { "tsconfig.json": alias("x") }, "tsconfig.json"],
    [
      "what tsconfig.json extends is edited",
      { "tsconfig.json": { extends: "./base.json" }, "base.json": alias("x") },
      "base.json",
    ],
  ])("%s", (_, configs, edited) => {
    using p = project({ "a.js": "" });
    for (const [name, config] of Object.entries(configs)) p.write(name, config);
    expect(p.resolve("y")).toBeNull();
    p.write(edited, alias("y"));
    expect(p.resolve("y")).toBe("a.js");
  });

  test("what tsconfig.json extends is made in another directory", () => {
    using p = project({ "tsconfig.json": `{ "extends": "./base/tsconfig.json" }`, "base/a.js": "" });
    expect(p.resolve("y")).toBeNull();
    p.write("base/tsconfig.json", alias("y"));
    expect(p.resolve("y")).toBe("base/a.js");
  });

  test.each([
    ["node_modules/pkg/index.js", {}, "", "pkg", "node_modules/pkg/index.js"],
    ["package.json", {}, { imports: { "#b": "./a.js" } }, "#b", "a.js"],
    ["tsconfig.json", {}, alias("y"), "y", "a.js"],
    ["tsconfig.json", { "jsconfig.json": "{}" }, alias("y"), "y", "a.js"],
  ])("%s is made next to %j, and a build has listed it", async (name, files, contents, specifier, expected) => {
    using p = project({ ...files, "a.js": "" });
    expect(p.resolve(specifier)).toBeNull();
    p.write(name, contents);
    expect(await p.build("a.js")).toBeString();
    expect(p.resolve(specifier)).toBe(expected);
  });

  test.each([
    ["lib/tsconfig.json", "warn", { compilerOptions: { paths: { y: ["a.js"] } } }, `Non-relative path "a.js"`],
    ["lib/package.json", "warn", { type: "nope" }, `"nope" is not a valid value for "type"`],
    ["tsconfig.json", "error", { compilerOptions: { paths: { y: ["a.js"] } } }, `Non-relative path "a.js"`],
    ["package.json", "error", { type: "nope" }, `"nope" is not a valid value for "type"`],
  ])("the error still says what is wrong with %s (logLevel %s)", async (name, level, config, message) => {
    using p = project({
      "bunfig.toml": `logLevel = "${level}"`,
      "a.js": `require("./lib/a.js"); require("y");`,
      "lib": { "a.js": name.startsWith("lib/") ? `require("y");` : "", "tsconfig.json": "{}" },
    });
    p.write(name, config);
    const { stderr, exitCode } = await bunRun(p.at("a.js"));
    expect(stderr).toContain(message);
    expect(exitCode).toBe(1);
  });

  test("the error still says what is wrong with a tsconfig.json that a build with another one has read", async () => {
    using p = project({
      "other.json": "{}",
      "lib": { "a.js": "", "b.js": `require("y");`, "tsconfig.json": `{ "compilerOptions": { "jsxFactory": "a b" } }` },
      "a.js": `Bun.build({ entrypoints: ["lib/a.js"], target: "bun", tsconfig: "other.json" }).then(() => require("./lib/b.js"));`,
    });
    const { stderr, exitCode } = await bunRun(p.at("a.js"));
    expect(stderr).toContain(`Invalid JSX member expression: "a b"`);
    expect(exitCode).toBe(1);
  });

  test("package.json is read with the options of the build that looked", async () => {
    using p = project({
      "pkg/package.json": `{ "main": "./main.js", "browser": "./browser.js" }`,
      "pkg/main.js": `console.log("main");`,
      "pkg/browser.js": `console.log("browser");`,
      "a.js": `import "./pkg";`,
    });
    expect(p.resolve("./pkg")).toBe("pkg/main.js");
    expect(await p.build("pkg/missing.js", "browser")).toBeNull();
    expect(await p.build("a.js", "browser")).toContain(`console.log("browser")`);
  });
});

test.concurrent("a failed lookup in a worker leaves the dependencies in package.json to the installer", async () => {
  using p = await projectThatInstalls(
    { pkg: {} },
    {
      "package.json": `{ "dependencies": { "alias": "npm:pkg@1.0.0" } }`,
      "a.js": `
        const { Worker, isMainThread } = require("worker_threads");
        if (!isMainThread) try { require("missing"); } catch {}
        else new Worker(__filename).on("exit", () => console.log(typeof require.resolve("alias")));
      `,
    },
  );
  expect(await p.run("a.js")).toSpawn("string");
  expect(p.requests()).toEqual(["/pkg", "/pkg/-/pkg-1.0.0.tgz"]);
});

test("threads resolve through a linked directory that another thread keeps reading again", async () => {
  using dir = tempDir("runtime-cache-miss-threads", {
    ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`real/${i}.js`, ""])),
    "real/A": "",
    "main.cjs": `
      const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
      const fs = require("fs"), path = require("path"), { once } = require("events");
      if (isMainThread) {
        const stop = new Int32Array(new SharedArrayBuffer(4));
        const workers = Array.from({ length: 4 }, () => new Worker(__filename, { workerData: stop }));
        Promise.all(workers.map(worker => once(worker, "message"))).then(async () => {
          const names = ["a", "A"].map(name => path.join(__dirname, "real", name));
          for (let i = 0; i < process.argv[2]; i++) {
            // After a change of case every entry is new.
            fs.renameSync(...names.reverse());
            try { Bun.resolveSync("./link/missing.js", __dirname); } catch {}
          }
          const wrong = workers.map(worker => once(worker, "message"));
          Atomics.store(stop, 0, 1);
          console.log((await Promise.all(wrong)).join());
        });
      } else {
        let wrong = 0;
        parentPort.postMessage("ready");
        while (!Atomics.load(workerData, 0))
          for (let i = 0; i < 16; i++)
            if (Bun.resolveSync("./link/" + i + ".js", __dirname) !== path.join(__dirname, "real", i + ".js")) wrong++;
        parentPort.postMessage(wrong);
      }
    `,
  });
  symlinkSync(path.join(dir, "real"), path.join(dir, "link"), "junction");
  expect(await bunRun([path.join(dir, "main.cjs"), threadsAreSlow ? "500" : "10000"])).toSpawn("0,0,0,0");
});
