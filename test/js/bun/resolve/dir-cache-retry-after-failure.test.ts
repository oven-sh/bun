import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// The resolver caches every directory it reads, including the ones it did not
// find, for the life of the process and shares that cache between the runtime,
// every Worker, and every Bun.build() call. A lookup that failed because a
// file was not written yet used to stay failed after the file appeared: the
// retry only dropped the importer's own directory. Now a miss checks on disk
// each directory and entry the lookup did not find, drops the cached
// directories that changed, and resolves once more. A module file that
// disappeared from a cached listing drops its directory when the read fails.
//
// Each test runs one group of the fixture in its own process.
const files = {
  // node_modules exists before bun starts, so a miss is a miss and does not
  // turn into an auto-install from the registry.
  "node_modules/.keep": "",
  "package.json": `{ "name": "dir-cache-retry", "private": true }`,
  "helper.cjs": `
    module.exports = s => {
      try {
        return "OK " + require(s).v;
      } catch (e) {
        return "ERR " + e.message.split("\\n")[0];
      }
    };
  `,
  // A project whose tsconfig maps aliases onto directories; see the tsconfig group.
  "ts/tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"], "~/*": ["./gen/*"] } },
  }),
  "ts/app.mjs": `
    import fs from "node:fs";
    import path from "node:path";
    import { createRequire } from "node:module";
    import { fileURLToPath } from "node:url";
    const require = createRequire(import.meta.url);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const write = (file, contents) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    };
    // "@/*" maps onto a directory whose listing the first import cached.
    for (let i = 1; i <= 3; i++) {
      write(path.join(here, "files", "file-" + i + ".mjs"), "export const v = " + i + ";");
      try {
        console.log("P" + i, "OK", (await import("@/files/file-" + i + ".mjs")).v);
      } catch (e) {
        console.log("P" + i, "ERR", e.message.split("\\n")[0]);
      }
    }
    // The same through require() and a mapping onto a subdirectory.
    for (let i = 1; i <= 3; i++) {
      write(path.join(here, "gen", "mod-" + i + ".cjs"), "module.exports = { v: " + i + " };");
      try {
        console.log("Q" + i, "OK", require("~/mod-" + i + ".cjs").v);
      } catch (e) {
        console.log("Q" + i, "ERR", e.message.split("\\n")[0]);
      }
    }
  `,
  "main.mjs": `
    import fs from "node:fs";
    import path from "node:path";
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    import { Worker } from "node:worker_threads";
    const require = createRequire(import.meta.url);
    const helper = require.resolve("./helper.cjs");
    const req = require(helper);
    const nm = (...p) => path.join("node_modules", ...p);
    const write = (file, contents) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    };
    const t = async (label, specifier) => {
      try {
        console.log(label, "OK", (await import(specifier)).v);
      } catch (e) {
        console.log(label, "ERR", e.message.split("\\n")[0]);
      }
    };
    const installInto = (root, name) => {
      write(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ name, main: "i.js" }));
      write(path.join(root, "node_modules", name, "i.js"), "export const v = 42;");
    };
    const build = async (label, entry, plugins = []) => {
      try {
        console.log(label, "OK", (await Bun.build({ entrypoints: [entry], plugins })).outputs.length);
      } catch (e) {
        console.log(label, "ERR", (e.errors || []).map(x => x.message).join("|"));
      }
    };
    // Prints the resolved path relative to the fixture root, or the error code.
    const root = fs.realpathSync(process.cwd());
    const res = (label, fn) => {
      try {
        console.log(label, "OK", path.relative(root, fn()).split(path.sep).join("/"));
      } catch (e) {
        console.log(label, "ERR", e.code);
      }
    };
    // A require() whose lookups start from a directory other than this file's.
    const requireFrom = dir => createRequire(path.resolve(dir, "x.cjs"));

    const groups = {
      async search() {
        // A scoped subpath: two directory levels that did not exist.
        res("H1", () => require.resolve("@later/pkg/bin/tool.js"));
        write(nm("@later", "pkg", "bin", "tool.js"), "");
        res("H2", () => require.resolve("@later/pkg/bin/tool.js"));

        // The importing directory gains a node_modules of its own. This is the
        // shape of the bun npm package's postinstall: it runs from
        // node_modules/bun, downloads the platform package next to itself, and
        // resolves it again.
        fs.mkdirSync(nm("tool"));
        const toolRequire = requireFrom(nm("tool"));
        res("I1", () => toolRequire.resolve("@tool-platform/linux-x64/bin/tool.js"));
        write(nm("tool", "node_modules", "@tool-platform", "linux-x64", "bin", "tool.js"), "");
        res("I2", () => toolRequire.resolve("@tool-platform/linux-x64/bin/tool.js"));

        // An ancestor of the importing directory gains a node_modules.
        fs.mkdirSync(path.join("packages", "app", "scripts"), { recursive: true });
        const appRequire = requireFrom(path.join("packages", "app", "scripts"));
        res("J1", () => appRequire.resolve("app-dep/lib/entry.js"));
        write(path.join("packages", "app", "node_modules", "app-dep", "lib", "entry.js"), "");
        res("J2", () => appRequire.resolve("app-dep/lib/entry.js"));
        // The same when the importing directory already has a node_modules.
        fs.mkdirSync(path.join("packages", "web", "node_modules", "local-dep"), { recursive: true });
        const webRequire = requireFrom(path.join("packages", "web"));
        res("J3", () => webRequire.resolve("web-dep/lib/entry.js"));
        write(path.join("packages", "node_modules", "web-dep", "lib", "entry.js"), "");
        res("J4", () => webRequire.resolve("web-dep/lib/entry.js"));
        // The same when the importing directory is inside a node_modules.
        fs.mkdirSync(path.join("tools", "cli", "node_modules", "inner"), { recursive: true });
        const innerRequire = requireFrom(path.join("tools", "cli", "node_modules", "inner"));
        res("J5", () => innerRequire.resolve("cli-dep/lib/entry.js"));
        write(path.join("tools", "node_modules", "cli-dep", "lib", "entry.js"), "");
        res("J6", () => innerRequire.resolve("cli-dep/lib/entry.js"));

        // A relative specifier naming a directory that did not exist.
        res("K1", () => require.resolve("./lib"));
        write(path.join("lib", "index.js"), "");
        res("K2", () => require.resolve("./lib"));

        // A package created under a require.resolve() "paths" root.
        fs.mkdirSync(path.join("other", "node_modules"), { recursive: true });
        const opts = { paths: [path.resolve("other")] };
        res("L1", () => require.resolve("other-pkg", opts));
        write(path.join("other", "node_modules", "other-pkg", "index.js"), "");
        res("L2", () => require.resolve("other-pkg", opts));

        // What stays missing keeps failing, and what resolved keeps resolving.
        res("M1", () => require.resolve("never-installed"));
        res("M2", () => require.resolve("never-installed"));
        res("M3", () => require.resolve("@later/pkg/missing.js"));
        res("M4", () => require.resolve("@later/pkg/missing.js"));
        res("M5", () => require.resolve("@later/pkg/bin/tool.js"));
      },

      async symlink() {
        // A package symlinked in after the miss resolves to its real path.
        write(path.join("vendor", "linked-pkg", "index.js"), "");
        res("N1", () => require.resolve("linked-pkg"));
        fs.symlinkSync(path.resolve("vendor", "linked-pkg"), nm("linked-pkg"));
        res("N2", () => require.resolve("linked-pkg"));
      },

      async nodepath() {
        // A package created in a NODE_PATH directory (the env var names ./global).
        res("O1", () => require.resolve("global-pkg"));
        write(path.join("global", "global-pkg", "index.js"), "");
        res("O2", () => require.resolve("global-pkg"));
      },

      async tsconfig() {
        // tsconfig "paths" aliases onto directories that gain files later.
        await import("./ts/app.mjs");
      },

      async fileurl() {
        // A file URL through a symlinked root, like macOS's /var -> /private/var
        // (the test creates var -> private/var before bun starts). The loader
        // resolves the real path with no importer, and a file created after
        // the real directory was listed has to be found.
        const root = path.resolve("var", "folders", "t");
        fs.mkdirSync(root, { recursive: true });
        const load = async (label, name) => {
          try {
            console.log(label, "OK", (await import(pathToFileURL(path.join(root, name)).href)).v);
          } catch (e) {
            console.log(label, "ERR", e.message.split("\\n")[0]);
          }
        };
        write(path.join(root, "a.mjs"), "export const v = 1;");
        await load("R1", "a.mjs");
        write(path.join(root, "b.mjs"), "export const v = 2;");
        await load("R2", "b.mjs");
        write(path.join(root, "c.mjs"), "export const v = 3;");
        await load("R3", "c.mjs");
      },

      async require() {
        // "main" target written after the miss.
        write(nm("p1", "package.json"), '{"name":"p1","main":"./i.js"}');
        console.log("A1", req("p1"));
        write(nm("p1", "i.js"), "module.exports = { v: 42 };");
        console.log("A2", req("p1"));
        console.log("A2sub", req("p1/i.js"));

        // package.json read while half written, then valid.
        write(nm("p2", "i.js"), "module.exports = { v: 42 };");
        write(nm("p2", "package.json"), '{"name":"p2","main": ');
        console.log("B1", req("p2"));
        write(nm("p2", "package.json"), '{"name":"p2","main":"./i.js"}');
        console.log("B2", req("p2"));

        // A directory imported before its index file exists.
        fs.mkdirSync("dir");
        console.log("C1", req("./dir"));
        write(path.join("dir", "index.js"), "module.exports = { v: 42 };");
        console.log("C2", req("./dir"));

        // "exports" target whose directory is created after the miss, with import().
        write(nm("p3", "package.json"), '{"name":"p3","exports":{".":"./dist/index.js"}}');
        await t("F1", "p3");
        write(nm("p3", "dist", "index.js"), "export const v = 42;");
        await t("F2", "p3");
      },

      async worker() {
        // A file added to a package that was already resolved, seen by this
        // thread and by a new Worker, which shares the process-wide cache.
        write(nm("pkg", "package.json"), '{"name":"pkg"}');
        write(nm("pkg", "index.js"), "module.exports = { v: 1 };");
        console.log("D1", req("pkg"));
        write(nm("pkg", "extra.js"), "module.exports = { v: 2 };");
        console.log("D2", req("pkg/extra.js"));
        write(nm("pkg", "more.js"), "module.exports = { v: 3 };");
        const worker = new Worker(
          'const req = require(' + JSON.stringify(helper) + '); postMessage(req("pkg/more.js"));',
          { eval: true },
        );
        const fromWorker = await new Promise((resolve, reject) => {
          worker.on("message", resolve);
          worker.on("error", reject);
          worker.on("exit", code => reject(new Error("worker exited with " + code + " before posting")));
        });
        console.log("D3", fromWorker);
        await worker.terminate();
      },

      async reinstall() {
        // The package is replaced with a version whose entry file has another
        // name. The stale listing still names the old file, so the first load
        // fails reading it and drops the directory. The next one resolves again.
        const install = (version, main) => {
          fs.rmSync(nm("pkg2"), { recursive: true, force: true });
          write(nm("pkg2", "package.json"), JSON.stringify({ name: "pkg2", version, main }));
          write(nm("pkg2", main), "module.exports = { v: " + JSON.stringify(version) + " };");
        };
        install("1.0.0", "lib1.js");
        console.log("E1", req("pkg2"));
        install("2.0.0", "lib2.js");
        for (const k in require.cache) delete require.cache[k];
        console.log("E2", req("pkg2"));
        console.log("E3", req("pkg2"));
      },

      async build() {
        // Bun.build() shares the cache across calls. Five shapes of "installed
        // after the first build failed".
        // node_modules did not exist.
        write(path.join("g1", "ent.ts"), 'import { v } from "dpk1"; console.log(v);');
        await build("G1a", path.join("g1", "ent.ts"));
        installInto("g1", "dpk1");
        await build("G1b", path.join("g1", "ent.ts"));
        // node_modules existed, the package did not.
        write(path.join("g2", "ent.ts"), 'import { v } from "dpk2"; console.log(v);');
        installInto("g2", "other");
        await build("G2a", path.join("g2", "ent.ts"));
        installInto("g2", "dpk2");
        await build("G2b", path.join("g2", "ent.ts"));
        // package.json existed, its main file did not.
        write(path.join("g3", "ent.ts"), 'import { v } from "dpk3"; console.log(v);');
        write(path.join("g3", "node_modules", "dpk3", "package.json"), '{"name":"dpk3","main":"i.js"}');
        await build("G3a", path.join("g3", "ent.ts"));
        write(path.join("g3", "node_modules", "dpk3", "i.js"), "export const v = 42;");
        await build("G3b", path.join("g3", "ent.ts"));
        // An onResolve plugin that matches but declines routes the lookup
        // through the bundler's other resolver call.
        const declining = [{ name: "declining", setup: b => b.onResolve({ filter: /^dpk4$/ }, () => undefined) }];
        write(path.join("g4", "ent.ts"), 'import { v } from "dpk4"; console.log(v);');
        await build("G4a", path.join("g4", "ent.ts"), declining);
        installInto("g4", "dpk4");
        await build("G4b", path.join("g4", "ent.ts"), declining);
        // A bare specifier as the entry point, installed after the first build.
        await build("G5a", "dpk5");
        installInto(".", "dpk5");
        await build("G5b", "dpk5");
      },
    };

    await groups[process.argv[2]]();
  `,
};

async function runGroup(
  group: string,
  env: (dir: string) => Record<string, string> = () => ({}),
  setup: (dir: string) => void = () => {},
) {
  using dir = tempDir("dir-cache-retry", files);
  setup(String(dir));
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs", group],
    env: { ...bunEnv, ...env(String(dir)) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr: stderr.trim(), exitCode };
}

describe.concurrent("a failed resolution sees files and packages created after the miss", () => {
  test("packages and directories created in the node_modules search path", async () => {
    expect(await runGroup("search")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "H1 ERR MODULE_NOT_FOUND
      H2 OK node_modules/@later/pkg/bin/tool.js
      I1 ERR MODULE_NOT_FOUND
      I2 OK node_modules/tool/node_modules/@tool-platform/linux-x64/bin/tool.js
      J1 ERR MODULE_NOT_FOUND
      J2 OK packages/app/node_modules/app-dep/lib/entry.js
      J3 ERR MODULE_NOT_FOUND
      J4 OK packages/node_modules/web-dep/lib/entry.js
      J5 ERR MODULE_NOT_FOUND
      J6 OK tools/node_modules/cli-dep/lib/entry.js
      K1 ERR MODULE_NOT_FOUND
      K2 OK lib/index.js
      L1 ERR MODULE_NOT_FOUND
      L2 OK other/node_modules/other-pkg/index.js
      M1 ERR MODULE_NOT_FOUND
      M2 ERR MODULE_NOT_FOUND
      M3 ERR MODULE_NOT_FOUND
      M4 ERR MODULE_NOT_FOUND
      M5 OK node_modules/@later/pkg/bin/tool.js"
      ,
      }
    `);
  });

  test.skipIf(isWindows)("a package symlinked in after the miss", async () => {
    expect(await runGroup("symlink")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "N1 ERR MODULE_NOT_FOUND
      N2 OK vendor/linked-pkg/index.js"
      ,
      }
    `);
  });

  test("tsconfig paths aliases onto directories that gain files later", async () => {
    expect(await runGroup("tsconfig")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "P1 OK 1
      P2 OK 2
      P3 OK 3
      Q1 OK 1
      Q2 OK 2
      Q3 OK 3"
      ,
      }
    `);
  });

  test.skipIf(isWindows)("a file URL through a symlinked root, with no importer", async () => {
    const linkedRoot = (dir: string) => {
      mkdirSync(join(dir, "private", "var", "folders"), { recursive: true });
      symlinkSync(join("private", "var"), join(dir, "var"));
    };
    expect(await runGroup("fileurl", undefined, linkedRoot)).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "R1 OK 1
      R2 OK 2
      R3 OK 3"
      ,
      }
    `);
  });

  test("a package created in a NODE_PATH directory", async () => {
    expect(await runGroup("nodepath", dir => ({ NODE_PATH: join(dir, "global") }))).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "O1 ERR MODULE_NOT_FOUND
      O2 OK global/global-pkg/index.js"
      ,
      }
    `);
  });

  test("require and import of a package or directory", async () => {
    expect(await runGroup("require")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "A1 ERR Cannot find module 'p1'
      A2 OK 42
      A2sub OK 42
      B1 ERR Cannot find module 'p2'
      B2 OK 42
      C1 ERR Cannot find module './dir'
      C2 OK 42
      F1 ERR Cannot find package 'p3' imported from <dir>/main.mjs
      F2 OK 42"
      ,
      }
    `);
  });

  test("a file added to a resolved package, from this thread and a Worker", async () => {
    expect(await runGroup("worker")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "D1 OK 1
      D2 OK 2
      D3 OK 3"
      ,
      }
    `);
  });

  test("a package replaced on disk with another entry file", async () => {
    expect(await runGroup("reinstall")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "E1 OK 1.0.0
      E2 ERR ENOENT reading "<dir>/node_modules/pkg2/lib1.js"
      E3 OK 2.0.0"
      ,
      }
    `);
  });

  test("Bun.build() after the package was installed", async () => {
    expect(await runGroup("build")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "G1a ERR Could not resolve: "dpk1". Maybe you need to "bun install"?
      G1b OK 1
      G2a ERR Could not resolve: "dpk2". Maybe you need to "bun install"?
      G2b OK 1
      G3a ERR Could not resolve: "dpk3". Maybe you need to "bun install"?
      G3b OK 1
      G4a ERR Could not resolve: "dpk4". Maybe you need to "bun install"?
      G4b OK 1
      G5a ERR ModuleNotFound resolving "dpk5" (entry point)
      G5b OK 1"
      ,
      }
    `);
  });
});
