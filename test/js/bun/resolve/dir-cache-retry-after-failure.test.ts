import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The resolver caches every directory it reads, including the ones it did not
// find, for the life of the process and shares that cache between the runtime,
// every Worker, and every Bun.build() call. A lookup that failed because a
// file was not written yet used to stay failed after the file appeared: the
// retry only dropped the importer's own directory. Now a miss runs the lookup
// once more to collect what it read from the cache, checks each of those facts
// on disk, drops the cached directories that changed, and resolves again.
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
    import { fileURLToPath, pathToFileURL } from "node:url";
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
        // The same when the "paths" root itself does not exist at the first call.
        const late = { paths: [path.resolve("late-root")] };
        res("L3", () => require.resolve("late-pkg", late));
        write(path.join("late-root", "node_modules", "late-pkg", "index.js"), "");
        res("L4", () => require.resolve("late-pkg", late));

        // A file two and three new directory levels deep. The run that misses reads the
        // new directories on its way, after it looked for the file.
        res("DL1", () => require.resolve("./deep/a/f.cjs"));
        write(path.join("deep", "a", "f.cjs"), "");
        res("DL2", () => require.resolve("./deep/a/f.cjs"));
        res("DL3", () => require.resolve("./deeper/a/b/f.cjs"));
        write(path.join("deeper", "a", "b", "f.cjs"), "");
        res("DL4", () => require.resolve("./deeper/a/b/f.cjs"));
        res("DL5", () => require.resolve(path.resolve("deepest", "a", "f.cjs")));
        write(path.join("deepest", "a", "f.cjs"), "");
        res("DL6", () => require.resolve(path.resolve("deepest", "a", "f.cjs")));

        // A new directory whose "main" points into a directory that was read before it.
        // The run after the first check reads the package.json, and misses again one step on.
        fs.mkdirSync("chain-lib");
        res("CH1", () => require.resolve("./chain-lib/x.cjs"));
        res("CH2", () => require.resolve("./chain"));
        write(path.join("chain", "package.json"), JSON.stringify({ main: "../chain-lib/x.cjs" }));
        write(path.join("chain-lib", "x.cjs"), "");
        res("CH3", () => require.resolve("./chain"));

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
        // A link whose target does not exist yet. Its directory is read for the
        // first time with the link in it, so the listing has the name all along.
        fs.mkdirSync(path.join("links", "node_modules"), { recursive: true });
        fs.symlinkSync(path.join("..", "late-target", "lib.cjs"), path.join("links", "late-link.cjs"));
        fs.symlinkSync(path.join("..", "..", "late-target", "pkg"), path.join("links", "node_modules", "late-linked"));
        const links = requireFrom("links");
        res("N3", () => links.resolve("./late-link.cjs"));
        res("N4", () => links.resolve("./late-link"));
        res("N5", () => links.resolve("late-linked"));
        write(path.join("late-target", "lib.cjs"), "");
        write(path.join("late-target", "pkg", "index.js"), "");
        res("N6", () => links.resolve("./late-link.cjs"));
        res("N7", () => links.resolve("./late-link"));
        res("N8", () => links.resolve("late-linked"));
      },

      async callers() {
        // The other ways to ask the resolver.
        res("MR1", () => fileURLToPath(import.meta.resolve("late-a")));
        write(nm("late-a", "index.js"), "");
        res("MR2", () => fileURLToPath(import.meta.resolve("late-a")));
        res("BR1", () => Bun.resolveSync("late-b", root));
        write(nm("late-b", "index.js"), "");
        res("BR2", () => Bun.resolveSync("late-b", root));
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
        // Then both threads add files to one directory and to the package, and each
        // resolves its own file at once. They find the same cached directories stale at
        // the same time, and only one of them is the one that drops a directory.
        fs.mkdirSync("shared-dir");
        write("steps.cjs", \`
          const fs = require("node:fs");
          const path = require("node:path");
          module.exports = id => {
            let failed = 0;
            for (let i = 0; i < 25; i++) {
              try {
                const file = path.resolve("shared-dir", "f" + id + "-" + i + ".cjs");
                fs.writeFileSync(file, "");
                require.resolve(file);
                fs.writeFileSync(path.join("node_modules", "pkg", "m" + id + "-" + i + ".js"), "");
                require.resolve("pkg/m" + id + "-" + i + ".js");
              } catch {
                failed++;
              }
            }
            return failed;
          };
        \`);
        const steps = path.resolve("steps.cjs");
        const started = new Int32Array(new SharedArrayBuffer(4));
        const worker = new Worker(
          'const { parentPort, workerData } = require("node:worker_threads");' +
            "const req = require(" +
            JSON.stringify(helper) +
            ");" +
            'parentPort.postMessage(req("pkg/more.js"));' +
            'parentPort.once("message", () => {' +
            "  Atomics.store(workerData.started, 0, 1);" +
            "  Atomics.notify(workerData.started, 0);" +
            "  parentPort.postMessage(require(" +
            JSON.stringify(steps) +
            ")(1));" +
            "});",
          { eval: true, workerData: { started } },
        );
        const fromWorker = () =>
          new Promise((resolve, reject) => {
            worker.once("message", resolve);
            worker.once("error", reject);
            worker.once("exit", code => reject(new Error("worker exited with " + code + " before posting")));
          });
        console.log("D3", await fromWorker());
        const theirs = fromWorker();
        worker.postMessage("go");
        Atomics.wait(started, 0, 0);
        const mine = require(steps)(0);
        console.log("steps that failed, of 25 in each thread:", mine, await theirs);
        await worker.terminate();
      },

      async manifest() {
        // A miss reads again the package.json of one directory: the parent of what the
        // specifier names, which is the importer's directory for "#alias" and for a
        // bare name of one segment.
        // "#alias" added to the package.json next to the importer.
        write(path.join("m1", "package.json"), JSON.stringify({ name: "m1", imports: {} }));
        write(path.join("m1", "impl.cjs"), "");
        const m1 = requireFrom("m1");
        res("S1", () => m1.resolve("#alias"));
        write(path.join("m1", "package.json"), JSON.stringify({ name: "m1", imports: { "#alias": "./impl.cjs" } }));
        res("S2", () => m1.resolve("#alias"));
        // A package that imports itself by name, once the package.json next to the
        // importer has that name and an "exports" map.
        write(path.join("m6", "package.json"), JSON.stringify({ name: "not-yet" }));
        write(path.join("m6", "feature.cjs"), "");
        const m6 = requireFrom("m6");
        res("SR1", () => m6.resolve("m6"));
        write(path.join("m6", "package.json"), JSON.stringify({ name: "m6", exports: { ".": "./feature.cjs" } }));
        res("SR2", () => m6.resolve("m6"));
        // A map that did not change keeps failing.
        res("W1", () => m1.resolve("#other"));
      },

      async unreadable() {
        // A directory that could not be opened when it was first read.
        write(path.join("locked", "a.cjs"), "");
        fs.chmodSync("locked", 0o000);
        res("UR1", () => require.resolve("./locked/a.cjs"));
        res("UR2", () => require.resolve("./locked/a.cjs"));
        fs.chmodSync("locked", 0o755);
        res("UR3", () => require.resolve("./locked/a.cjs"));
      },

      async kind() {
        // The kind of an entry is cached from its first stat(). Here a name changes
        // its kind after its directory was read.
        const kinds = requireFrom("kinds");
        // A directory with the name of a file, then that file.
        fs.mkdirSync(path.join("kinds", "a.cjs"), { recursive: true });
        res("KD1", () => kinds.resolve("./a.cjs"));
        fs.rmdirSync(path.join("kinds", "a.cjs"));
        write(path.join("kinds", "a.cjs"), "");
        res("KD2", () => kinds.resolve("./a.cjs"));
        // A file where a directory is looked up, then that directory.
        write(path.join("kinds", "b"), "");
        res("KD3", () => kinds.resolve("./b/index.cjs"));
        fs.rmSync(path.join("kinds", "b"));
        write(path.join("kinds", "b", "index.cjs"), "");
        res("KD4", () => kinds.resolve("./b/index.cjs"));
      },

      async config() {
        // A tsconfig.json is read with its directory, not by the lookup that
        // misses. A miss reads again the one of the importer's directory, and each
        // file it extends.
        const aliased = (name, target) =>
          JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { [name]: [target] } } });
        const project = name => {
          write(path.join(name, "src", "lib", "utils.cjs"), "");
          return requireFrom(path.join(name, "src"));
        };
        // Created in the importing directory.
        const c1 = project("c1");
        res("Y1", () => c1.resolve("c1-utils"));
        write(path.join("c1", "src", "tsconfig.json"), aliased("c1-utils", "./lib/utils.cjs"));
        res("Y2", () => c1.resolve("c1-utils"));
        // An alias added to the one that is there.
        write(path.join("c3", "src", "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
        const c3 = project("c3");
        res("Y5", () => c3.resolve("c3-utils"));
        write(path.join("c3", "src", "tsconfig.json"), aliased("c3-utils", "./lib/utils.cjs"));
        res("Y6", () => c3.resolve("c3-utils"));
        // An alias added to the file that it extends.
        write(path.join("c4", "base.json"), JSON.stringify({ compilerOptions: { baseUrl: "." } }));
        write(path.join("c4", "src", "tsconfig.json"), JSON.stringify({ extends: "../base.json" }));
        const c4 = project("c4");
        res("Y7", () => c4.resolve("c4-utils"));
        write(path.join("c4", "base.json"), aliased("c4-utils", "./src/lib/utils.cjs"));
        res("Y8", () => c4.resolve("c4-utils"));
        // A jsconfig.json.
        const c5 = project("c5");
        res("Y9", () => c5.resolve("c5-utils"));
        write(path.join("c5", "src", "jsconfig.json"), aliased("c5-utils", "./lib/utils.cjs"));
        res("Y10", () => c5.resolve("c5-utils"));
        // One that was read while half written.
        write(path.join("c6", "src", "tsconfig.json"), '{ "compilerOptions": ');
        const c6 = project("c6");
        res("Y11", () => c6.resolve("c6-utils"));
        write(path.join("c6", "src", "tsconfig.json"), aliased("c6-utils", "./lib/utils.cjs"));
        res("Y12", () => c6.resolve("c6-utils"));
        // One that did not change keeps failing.
        res("Y15", () => c1.resolve("c1-other"));
        res("Y16", () => c3.resolve("c3-other"));
      },

      async steady() {
        // The test wrote these files before this process started, and nothing
        // changes on disk here. So no miss may drop a directory: a directory that
        // is dropped is read again, and its package.json parsed again, into memory
        // that is never freed.
        const { resolverDirInfoSlotsUsed } = require("bun:internal-for-testing");
        const s1 = requireFrom("s1");
        const s2 = requireFrom("s2");
        const s3 = requireFrom(path.join("s3", "src"));
        const s5 = requireFrom(path.join("s5", "src"));
        const misses = [
          // A package that is not installed, and a file that an installed one does not have.
          ["Z1", () => require.resolve("never-installed")],
          ["Z2", () => require.resolve("s0/hidden")],
          // A file that is not there, by a relative and by an absolute path.
          ["Z3", () => require.resolve("./nope.cjs")],
          ["Z4", () => require.resolve(path.resolve("nope.cjs"))],
          // The package.json next to the importer has a byte order mark, which the loader strips.
          ["Z5", () => s1.resolve("#x")],
          // The same in UTF-16.
          ["Z6", () => s2.resolve("#x")],
          // A package.json that does not parse, above the importer.
          ["Z7", () => s3.resolve("#x")],
          // The tsconfig.json next to the importer has a byte order mark, and extends a file
          // that is not there.
          ["Z8", () => s5.resolve("s5-utils")],
          // A path below a file.
          ["Z9", () => require.resolve("./s6.cjs/sub")],
          // A link whose target is not there.
          ["Z10", () => require.resolve("./s7.cjs")],
        ];
        for (const [label, miss] of misses) res(label, miss);
        const before = resolverDirInfoSlotsUsed();
        for (let round = 0; round < 20; round++) {
          for (const [, miss] of misses) {
            try {
              miss();
            } catch {}
          }
        }
        console.log("directories read again by 200 more misses:", resolverDirInfoSlotsUsed() - before);
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
        // A CSS url() with a fragment: looked up as written, then without the fragment.
        write(path.join("g6", "ent.css"), 'a { background: url("./late.svg#frag"); }');
        await build("G6a", path.join("g6", "ent.css"));
        write(path.join("g6", "late.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
        await build("G6b", path.join("g6", "ent.css"));
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
      L3 ERR MODULE_NOT_FOUND
      L4 OK late-root/node_modules/late-pkg/index.js
      DL1 ERR MODULE_NOT_FOUND
      DL2 OK deep/a/f.cjs
      DL3 ERR MODULE_NOT_FOUND
      DL4 OK deeper/a/b/f.cjs
      DL5 ERR MODULE_NOT_FOUND
      DL6 OK deepest/a/f.cjs
      CH1 ERR MODULE_NOT_FOUND
      CH2 ERR MODULE_NOT_FOUND
      CH3 OK chain-lib/x.cjs
      M1 ERR MODULE_NOT_FOUND
      M2 ERR MODULE_NOT_FOUND
      M3 ERR MODULE_NOT_FOUND
      M4 ERR MODULE_NOT_FOUND
      M5 OK node_modules/@later/pkg/bin/tool.js"
      ,
      }
    `);
  });

  test.skipIf(isWindows)(
    "a package symlinked in after the miss, and a link whose target is written later",
    async () => {
      expect(await runGroup("symlink")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "N1 ERR MODULE_NOT_FOUND
      N2 OK vendor/linked-pkg/index.js
      N3 ERR MODULE_NOT_FOUND
      N4 ERR MODULE_NOT_FOUND
      N5 ERR MODULE_NOT_FOUND
      N6 OK late-target/lib.cjs
      N7 OK late-target/lib.cjs
      N8 OK late-target/pkg/index.js"
      ,
      }
    `);
    },
  );

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

  test("import.meta.resolve() and Bun.resolveSync() of a package created after the miss", async () => {
    expect(await runGroup("callers")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "MR1 ERR ERR_MODULE_NOT_FOUND
      MR2 OK node_modules/late-a/index.js
      BR1 ERR ERR_MODULE_NOT_FOUND
      BR2 OK node_modules/late-b/index.js"
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
      D3 OK 3
      steps that failed, of 25 in each thread: 0 0"
      ,
      }
    `);
  });

  test("an imports or exports entry added to the package.json next to the importer", async () => {
    expect(await runGroup("manifest")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "S1 ERR MODULE_NOT_FOUND
      S2 OK m1/impl.cjs
      SR1 ERR MODULE_NOT_FOUND
      SR2 OK m6/feature.cjs
      W1 ERR MODULE_NOT_FOUND"
      ,
      }
    `);
  });

  // Permissions do not stop the superuser, and Windows has no such mode.
  test.skipIf(isWindows || process.getuid?.() === 0)("a directory that could not be read at first", async () => {
    expect(await runGroup("unreadable")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "UR1 ERR MODULE_NOT_FOUND
      UR2 ERR MODULE_NOT_FOUND
      UR3 OK locked/a.cjs"
      ,
      }
    `);
  });

  test("a name that changes its kind after the miss", async () => {
    expect(await runGroup("kind")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "KD1 ERR MODULE_NOT_FOUND
      KD2 OK kinds/a.cjs
      KD3 ERR MODULE_NOT_FOUND
      KD4 OK kinds/b/index.cjs"
      ,
      }
    `);
  });

  test("a tsconfig.json created or changed next to the importer after the miss", async () => {
    expect(await runGroup("config")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "Y1 ERR MODULE_NOT_FOUND
      Y2 OK c1/src/lib/utils.cjs
      Y5 ERR MODULE_NOT_FOUND
      Y6 OK c3/src/lib/utils.cjs
      Y7 ERR MODULE_NOT_FOUND
      Y8 OK c4/src/lib/utils.cjs
      Y9 ERR MODULE_NOT_FOUND
      Y10 OK c5/src/lib/utils.cjs
      Y11 ERR MODULE_NOT_FOUND
      Y12 OK c6/src/lib/utils.cjs
      Y15 ERR MODULE_NOT_FOUND
      Y16 ERR MODULE_NOT_FOUND"
      ,
      }
    `);
  });

  test("a miss drops no directory when nothing changed on disk", async () => {
    const steadyFiles = (dir: string) => {
      const write = (file: string, contents: string | Buffer) => {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), contents);
      };
      write("node_modules/s0/package.json", JSON.stringify({ name: "s0", exports: { ".": "./i.cjs" } }));
      write("node_modules/s0/i.cjs", "");
      const manifest = (name: string) => "\uFEFF" + JSON.stringify({ name, imports: { "#y": "./y.cjs" } });
      write("s1/package.json", manifest("s1"));
      write("s2/package.json", Buffer.from(manifest("s2"), "utf16le"));
      write("s3/package.json", `{ "name": "s3", `);
      mkdirSync(join(dir, "s3", "src"));
      const paths = { "s5-utils": ["./nowhere.cjs"] };
      write(
        "s5/src/tsconfig.json",
        "\uFEFF" + JSON.stringify({ extends: "./nowhere.json", compilerOptions: { baseUrl: ".", paths } }),
      );
      write("s6.cjs", "");
      // Not every Windows user may create a link. Without it the lookup misses all the same.
      try {
        symlinkSync("nowhere.cjs", join(dir, "s7.cjs"));
      } catch {}
    };
    expect(await runGroup("steady", undefined, steadyFiles)).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "Z1 ERR MODULE_NOT_FOUND
      Z2 ERR MODULE_NOT_FOUND
      Z3 ERR MODULE_NOT_FOUND
      Z4 ERR MODULE_NOT_FOUND
      Z5 ERR MODULE_NOT_FOUND
      Z6 ERR MODULE_NOT_FOUND
      Z7 ERR MODULE_NOT_FOUND
      Z8 ERR MODULE_NOT_FOUND
      Z9 ERR MODULE_NOT_FOUND
      Z10 ERR MODULE_NOT_FOUND
      directories read again by 200 more misses: 0"
      ,
      }
    `);
  });

  // A watcher drops the directory that changed. The directories below it still point at
  // the entry that was dropped, so a lookup that walks up from them reads the old package.json.
  // Windows is left out: its watcher can start to listen after the first run has printed.
  test.skipIf(isWindows)("bun --hot: an imports entry added to a package.json above the importer", async () => {
    using dir = tempDir("dir-cache-retry-hot", {
      "node_modules/.keep": "",
      "package.json": JSON.stringify({ name: "hot-alias" }),
      "impl.cjs": `module.exports = "impl";`,
      "src/x.cjs": `
        let found;
        try {
          found = "OK " + require("#alias");
        } catch (e) {
          found = "ERR " + e.code;
        }
        module.exports = found;
      `,
      "server.js": `console.log("run 1: " + require("./src/x.cjs"));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const line = async (pattern: RegExp) => {
      for (;;) {
        const found = output.match(pattern);
        if (found) return found[0];
        const { value, done } = await reader.read();
        if (done) throw new Error(`bun --hot exited before ${pattern}. Output:\n${output}`);
        output += decoder.decode(value, { stream: true });
      }
    };
    expect(await line(/run 1: .*/)).toBe("run 1: ERR MODULE_NOT_FOUND");

    // A rename, so that the watcher sees a change of the directory.
    const manifest = join(String(dir), "package.json");
    writeFileSync(manifest + ".tmp", JSON.stringify({ name: "hot-alias", imports: { "#alias": "./impl.cjs" } }));
    renameSync(manifest + ".tmp", manifest);
    writeFileSync(join(String(dir), "server.js"), `console.log("run 2: " + require("./src/x.cjs"));`);
    expect(await line(/run 2: .*/)).toBe("run 2: OK impl");
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
      G5b OK 1
      G6a ERR Could not resolve: "./late.svg#frag"
      G6b OK 1"
      ,
      }
    `);
  });
});
