import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
  unprivilegedSpawnOptions,
} from "harness";
import { chmodSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

// The resolver caches every directory it reads, including the ones it did not
// find, for the life of the process and shares that cache between the runtime,
// every Worker, and every Bun.build() call. A lookup that failed because a
// file was not written yet used to stay failed after the file appeared: the
// retry only dropped the importer's own directory. Now a lookup that misses
// runs once more, and that run asks the disk about each thing it takes from
// the caches: a listing whose directory changed is read again in place, and a
// directory record whose facts changed is replaced by a new one.
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
  // #12372 from the ways to ask that ts/app.mjs does not use; see the issues group.
  "ts/apis.mjs": `
    import fs from "node:fs";
    import path from "node:path";
    import { createRequire } from "node:module";
    import { fileURLToPath } from "node:url";
    const require = createRequire(import.meta.url);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const elsewhere = () => createRequire(path.join(here, "x.cjs"));
    const ways = {
      "require.resolve()": s => require.resolve(s),
      "require.resolve() with paths": s => require.resolve(s, { paths: [here] }),
      "import.meta.resolve()": s => fileURLToPath(import.meta.resolve(s)),
      "Bun.resolveSync()": s => Bun.resolveSync(s, here),
      "Bun.resolve()": s => Bun.resolve(s, here),
      "createRequire()": s => elsewhere()(s).file,
      "createRequire().resolve()": s => elsewhere().resolve(s),
    };
    // The first import lists the directory that the alias names. Each way then asks for a
    // file of its own, written after that.
    fs.mkdirSync(path.join(here, "api"));
    fs.writeFileSync(path.join(here, "api", "first.mjs"), "");
    await import("@/api/first.mjs");
    let n = 0;
    for (const [way, ask] of Object.entries(ways)) {
      const file = path.join(here, "api", "late-" + ++n + ".cjs");
      fs.writeFileSync(file, "exports.file = __filename;");
      try {
        console.log(way, "OK", path.basename(await ask("@/api/late-" + n + ".cjs")));
      } catch (e) {
        console.log(way, "ERR", e.code);
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
    // For a group whose misses change nothing on disk: the test wrote its files before this
    // process started. Each miss runs its lookup once more, and that run asks the disk about
    // each directory and config file that it takes from the caches. None of them changed. So
    // no directory gets a new record or a new listing: those take memory that is never freed.
    // And no listing is read again, except on Windows: see keepsListings. This prints what
    // each miss answers, then what 20 more rounds of the misses add to each counter of the
    // resolver. The fixture is in the directory "here".
    const unchangedMisses = (here, misses) => {
      const { getCounters } = require("bun:internal-for-testing");
      for (const [label, miss] of misses) res(label, miss);
      // What one more round of the misses adds to each counter of the resolver.
      const round = () => {
        const before = getCounters().resolver;
        for (const [, miss] of misses) {
          try {
            miss();
          } catch {}
        }
        const after = getCounters().resolver;
        const added = {};
        for (const name of Object.keys(after)) added[name] = after[name] - before[name];
        return added;
      };
      // The directories above the fixture are every test's: the temporary directory changes
      // with each test that starts or ends, and a miss reads again a directory that changed.
      // This tells when one of them did: each directory above, and the node_modules in it,
      // which the lookup of a package reads.
      const above = [];
      for (let dir = path.dirname(here); dir !== above.at(-1); dir = path.dirname(dir)) above.push(dir);
      const stamp = dir => {
        try {
          const { ino, mtimeNs, ctimeNs } = fs.statSync(dir, { bigint: true });
          return [ino, mtimeNs, ctimeNs].join(" ");
        } catch {
          return "none";
        }
      };
      // The directories above as they were last seen, and when they were first seen so.
      let seen;
      let since;
      const look = () => {
        const now = above.flatMap(dir => [stamp(dir), stamp(path.join(dir, "node_modules"))]).join();
        if (now !== seen) [seen, since] = [now, performance.now()];
        return now;
      };
      look();
      // Windows lists a directory without its identity, and reads each listing again.
      const keepsListings = process.platform !== "win32";
      // A listing that was read right after its directory changed is read once more: the times
      // of a directory cannot tell a later change from that one. So a round can read a listing
      // again for two reasons that are not the resolver's doing: the test has just written the
      // fixture, and a directory above changed. A round is charged with the listings that it
      // read again when no directory above changed during it, and none since a round that read
      // no listing again, or since a round that began a tenth of a second after the last
      // change, which is five times the margin of that rule.
      const more = { lookupsRunAgain: 0, dirInfoSlots: 0, newListings: 0, refills: 0 };
      // The directories above, as they were around the last round that read no listing again,
      // and around the last round that began that long after they changed.
      let kept;
      let settled;
      let charged = false;
      const run = counted => {
        const before = look();
        const late = performance.now() - since >= 100;
        const added = round();
        const calm = look() === before;
        const chargeable = calm && (before === kept || before === settled);
        settled = calm && late ? before : undefined;
        if (added.refills === 0) {
          if (calm) kept = before;
        } else if (chargeable) {
          charged = true;
          more.refills += added.refills;
        }
        if (counted) for (const name of ["lookupsRunAgain", "dirInfoSlots", "newListings"]) more[name] += added[name];
      };
      // Rounds until one reads no listing again, or is charged. The deadline is for directories
      // above that keep changing.
      const deadline = performance.now() + 1000;
      while (keepsListings && kept === undefined && !charged && performance.now() < deadline) run(false);
      for (let i = 0; i < 20; i++) run(true);
      const count = "by " + 20 * misses.length + " more misses:";
      console.log("lookups run again", count, more.lookupsRunAgain);
      console.log("new directory records", count, more.dirInfoSlots);
      console.log("new listings", count, more.newListings);
      if (keepsListings) console.log("listings read again", count, more.refills);
    };

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
        // The link type is for Windows, where a link to a directory is a junction.
        write(path.join("vendor", "linked-pkg", "index.js"), "");
        res("N1", () => require.resolve("linked-pkg"));
        fs.symlinkSync(path.resolve("vendor", "linked-pkg"), nm("linked-pkg"), "junction");
        res("N2", () => require.resolve("linked-pkg"));
        // A link whose target does not exist yet. Its directory is read for the
        // first time with the link in it, so the listing has the name all along.
        fs.mkdirSync(path.join("links", "node_modules"), { recursive: true });
        fs.symlinkSync(path.join("..", "late-target", "lib.cjs"), path.join("links", "late-link.cjs"), "file");
        fs.symlinkSync(
          path.join("..", "..", "late-target", "pkg"),
          path.join("links", "node_modules", "late-linked"),
          "junction",
        );
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
        fs.writeFileSync("steps.cjs", \`
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
        // A miss that reads no config file still reads again the ones of the directory
        // it names: here the alias has another target since its last lookup.
        const retarget = (label, name, missing) => {
          write(path.join(name, "a.cjs"), "");
          write(path.join(name, "b.cjs"), "");
          write(path.join(name, "tsconfig.json"), aliased("target", "./a.cjs"));
          const from = requireFrom(name);
          res(label + "1", () => from.resolve("target"));
          write(path.join(name, "tsconfig.json"), aliased("target", "./b.cjs"));
          res(label + "2", () => from.resolve(missing));
          res(label + "3", () => from.resolve("target"));
        };
        retarget("YR", "c7", "./nope.cjs");
        retarget("YA", "c8", path.resolve("c8", "nope.cjs"));
      },

      async links() {
        // A directory that is read again gets a new entry in the cache. The directories
        // below it keep their link to its old entry, and a lookup from one of them walks
        // up through the old ones.
        const staleLinks = (label, top, depth) => {
          const level = k => path.join(top, ...Array.from({ length: k }, (_, i) => "l" + (i + 1)));
          const manifest = extra => JSON.stringify({ name: top, imports: { "#other": "./impl.cjs", ...extra } });
          write(path.join(top, "package.json"), manifest({}));
          write(path.join(top, "impl.cjs"), "");
          fs.mkdirSync(level(depth), { recursive: true });
          const deepest = requireFrom(level(depth));
          res(label + "1", () => deepest.resolve("#alias"));
          // Deepest first, each directory between the importer's and the top one is read
          // again: a file appears in it after a miss.
          for (let k = depth - 1; k >= 1; k--) {
            const parent = requireFrom(level(k - 1));
            const file = "./l" + k + "/new.cjs";
            try {
              parent.resolve(file);
            } catch {}
            write(path.join(level(k), "new.cjs"), "");
            parent.resolve(file);
          }
          write(path.join(top, "package.json"), manifest({ "#alias": "./impl.cjs" }));
          res(label + "2", () => requireFrom(top).resolve("#alias"));
          res(label + "3", () => deepest.resolve("#alias"));
        };
        staleLinks("LA", "two", 2);
        staleLinks("LB", "three", 3);

        // require.resolve() with "paths": the lookup starts below the importer's directory
        // and reads the importer's config files through the link to it.
        const tsconfig = names =>
          JSON.stringify({ compilerOptions: { paths: Object.fromEntries(names.map(name => [name, ["./real.cjs"]])) } });
        const below = name => {
          write(path.join(name, "real.cjs"), "");
          fs.mkdirSync(path.join(name, "sub"));
          return { paths: [path.resolve(name, "sub")] };
        };
        const r1 = below("r1");
        write(path.join("r1", "tsconfig.json"), tsconfig(["other"]));
        res("LP1", () => requireFrom("r1").resolve("late-alias", r1));
        write(path.join("r1", "tsconfig.json"), tsconfig(["other", "late-alias"]));
        res("LP2", () => requireFrom("r1").resolve("late-alias", r1));
        const r2 = below("r2");
        write(path.join("r2", "package.json"), JSON.stringify({ name: "r2", imports: { "#other": "./real.cjs" } }));
        res("LP3", () => requireFrom("r2").resolve("#late", r2));
        write(
          path.join("r2", "package.json"),
          JSON.stringify({ name: "r2", imports: { "#other": "./real.cjs", "#late": "./real.cjs" } }),
        );
        res("LP4", () => requireFrom("r2").resolve("#late", r2));
        // The same when the importer's directory was read again in between: the
        // directory below it links to an old entry, and the new entry is stale too.
        const r3 = below("r3");
        write(path.join("r3", "tsconfig.json"), tsconfig(["other"]));
        res("LT1", () => requireFrom("r3").resolve("late1", r3));
        write(path.join("r3", "tsconfig.json"), tsconfig(["other", "late0"]));
        res("LT2", () => requireFrom("r3").resolve("late0"));
        write(path.join("r3", "tsconfig.json"), tsconfig(["other", "late0", "late1"]));
        res("LT3", () => requireFrom("r3").resolve("late1", r3));

        // A tsconfig.json created next to the importer, whose directory links to an
        // old entry of the directory above it.
        write(path.join("q", "src", "real.cjs"), "");
        const src = requireFrom(path.join("q", "src"));
        res("LC1", () => src.resolve("made-alias"));
        try {
          requireFrom("q").resolve("./new.cjs");
        } catch {}
        write(path.join("q", "new.cjs"), "");
        requireFrom("q").resolve("./new.cjs");
        write(path.join("q", "src", "tsconfig.json"), tsconfig(["made-alias"]));
        res("LC2", () => src.resolve("made-alias"));

        // Two stale things in a row: the alias is new in the tsconfig.json, and its
        // target is new in a directory that was listed before.
        write(path.join("w", "lib", "old.cjs"), "");
        const aliases = extra =>
          JSON.stringify({ compilerOptions: { paths: { other: ["./lib/old.cjs"], ...extra } } });
        write(path.join("w", "tsconfig.json"), aliases({}));
        const w = requireFrom("w");
        res("LS1", () => w.resolve("late-alias"));
        res("LS2", () => w.resolve("other"));
        write(path.join("w", "lib", "new.cjs"), "");
        write(path.join("w", "tsconfig.json"), aliases({ "late-alias": ["./lib/new.cjs"] }));
        res("LS3", () => w.resolve("late-alias"));

        // More than one directory to link again in one lookup. The importer's package.json
        // no longer parses, so the lookup walks up. Two levels above, the directory with the
        // alias has a new entry.
        const manifest = (name, imports) => JSON.stringify({ name, imports });
        write(path.join("n", "b", "c", "package.json"), manifest("c", { "#other": "./m.cjs" }));
        const n = requireFrom(path.join("n", "b", "c"));
        res("LN1", () => n.resolve("not-installed"));
        write(path.join("n", "lib.cjs"), "");
        write(path.join("n", "b", "c", "package.json"), '{ "name": ');
        write(path.join("n", "package.json"), manifest("n", { "#late": "./lib.cjs" }));
        res("LN2", () => requireFrom("n").resolve("#late"));
        res("LN3", () => n.resolve("#late"));

        // The same with each directory of the chain on an old entry of the one above it.
        const again = dir => {
          try {
            requireFrom(dir).resolve("./late.cjs");
          } catch {}
          write(path.join(dir, "late.cjs"), "");
          requireFrom(dir).resolve("./late.cjs");
        };
        write(path.join("o", "b", "c", "d", "package.json"), manifest("d", { "#other": "./m.cjs" }));
        const o = requireFrom(path.join("o", "b", "c", "d"));
        res("LO1", () => o.resolve("#late"));
        again("o");
        res("LO2", () => requireFrom(path.join("o", "b", "c")).resolve("not-installed"));
        write(path.join("o", "b", "lib.cjs"), "");
        write(path.join("o", "b", "package.json"), manifest("b", { "#late": "./lib.cjs" }));
        res("LO3", () => requireFrom(path.join("o", "b")).resolve("#late"));
        write(path.join("o", "b", "c", "d", "package.json"), '{ "name": ');
        res("LO4", () => o.resolve("#late"));

        // A lookup that starts below the importer, whose package.json gets the alias while
        // the directory above it gets a node_modules.
        fs.mkdirSync(path.join("g", "b", "c", "d"), { recursive: true });
        res("LG1", () => requireFrom(path.join("g", "b", "c")).resolve("#late"));
        write(path.join("g", "node_modules", "x", "package.json"), JSON.stringify({ name: "x" }));
        write(path.join("g", "b", "lib.cjs"), "");
        write(path.join("g", "b", "package.json"), manifest("b", { "#late": "./lib.cjs" }));
        res("LG2", () => requireFrom(path.join("g", "b")).resolve("#late", { paths: [path.resolve("g", "b", "c", "d")] }));
      },

      async steady() {
        // The working directory can be another one: see the test.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const s1 = requireFrom(path.join(here, "s1"));
        const s2 = requireFrom(path.join(here, "s2"));
        const s3 = requireFrom(path.join(here, "s3", "src"));
        const s5 = requireFrom(path.join(here, "s5", "src"));
        const misses = [
          // A package that is not installed, and a file that an installed one does not have.
          ["Z1", () => require.resolve("never-installed")],
          ["Z2", () => require.resolve("s0/hidden")],
          // A file that is not there, by a relative and by an absolute path.
          ["Z3", () => require.resolve("./nope.cjs")],
          ["Z4", () => require.resolve(path.join(here, "nope.cjs"))],
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
        unchangedMisses(here, misses);
      },

      async unparsed() {
        // The test wrote config files that do not parse. A lookup that misses says what is
        // wrong with each one that it read. The record of a directory keeps what reading its
        // config files logged, and the run after a miss writes that again for each record that
        // it keeps. So every miss reports the same, and no directory gets a new record for it.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const from = (...dir) => requireFrom(path.join(here, ...dir));
        // The notes of an error, each as "note: <what is wrong> at <file>:<line>:<column>".
        const notesOf = e => {
          const lines = Bun.inspect(e).split("\\n");
          const notes = lines.flatMap((line, i) =>
            line.startsWith("note: ") ? [line + " " + (lines[i + 1] ?? "").trim()] : [],
          );
          return notes.join(", ") || "no notes";
        };
        // What the runs of each miss reported: one text for a miss when every run of it, the
        // first one and each one after it, reports the same.
        const reported = {};
        const noted = (label, miss) => [
          label,
          () => {
            try {
              return miss();
            } catch (e) {
              (reported[label] ??= new Set()).add(notesOf(e));
              throw e;
            }
          },
        ];
        unchangedMisses(here, [
          // The package.json next to the importer, for a package and for an alias of its "imports".
          noted("UP1", () => from("up1").resolve("never-installed")),
          noted("UP2", () => from("up1").resolve("#x")),
          // The tsconfig.json next to the importer, and the file that one extends.
          noted("UP3", () => from("up2").resolve("never-installed")),
          noted("UP4", () => from("up3").resolve("never-installed")),
          // The package.json above the importer.
          noted("UP5", () => from("up4", "src").resolve("never-installed")),
          // The package.json of the package that is asked for.
          noted("UP6", () => from("up5").resolve("pkg")),
          // Two files: the package.json above the importer, and the tsconfig.json next to it.
          noted("UP7", () => from("up6", "src").resolve("never-installed")),
        ]);
        for (const [label, notes] of Object.entries(reported)) console.log(label, "reported", [...notes].join(" or "));
      },

      async unlistable() {
        // The test made "xonly" a directory that the user of this process can enter and cannot
        // list. Such a directory reads as an empty one, so the node_modules in it is not
        // searched. Nothing tells whether it is as it was, so the run after a miss tries once
        // more to list it. That fails as before, and gives it no new record and no new listing.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const src = requireFrom(path.join(here, "xonly", "proj", "src"));
        const misses = [
          // A package that is not installed, and one that the node_modules of "xonly" has.
          ["XA", () => src.resolve("never-installed")],
          ["XB", () => src.resolve("held")],
          // An alias that the package.json below "xonly" does not have, and a file that is not there.
          ["XC", () => src.resolve("#x")],
          ["XD", () => src.resolve("./nope.cjs")],
        ];
        unchangedMisses(here, misses);
      },

      async changed() {
        // What was removed next to the importer after a miss. The old retry answered these as a
        // new process does: it dropped the importer's directory. Now the run after the miss
        // checks what it takes from the caches, and finds what is gone.
        const { getCounters } = require("bun:internal-for-testing");
        const ranAgain = getCounters().resolver.lookupsRunAgain;
        // The node_modules next to the importer has a copy of a package whose "exports" do not
        // cover the request. The copy is removed, as a dedupe does.
        const hoisted = top => {
          write(path.join(top, nm("pkg", "package.json")), JSON.stringify({ name: "pkg", main: "./index.js" }));
          write(path.join(top, nm("pkg", "index.js")), "");
        };
        const partial = JSON.stringify({ name: "pkg", exports: { "./other": "./o.js" } });
        hoisted("r1");
        write(path.join("r1", "sub", nm("pkg", "package.json")), partial);
        write(path.join("r1", "sub", nm("pkg", "o.js")), "");
        const r1 = requireFrom(path.join("r1", "sub"));
        res("RM1", () => r1.resolve("pkg"));
        fs.rmSync(path.join("r1", "sub", "node_modules"), { recursive: true });
        res("RM2", () => r1.resolve("pkg"));
        // The package.json next to the importer has the name of the package. It is deleted.
        hoisted("r2");
        write(path.join("r2", "sub", "package.json"), partial);
        write(path.join("r2", "sub", "o.js"), "");
        const r2 = requireFrom(path.join("r2", "sub"));
        res("RM3", () => r2.resolve("pkg"));
        fs.rmSync(path.join("r2", "sub", "package.json"));
        res("RM4", () => r2.resolve("pkg"));
        // Each of the four lookups missed on its first run, and ran once more.
        console.log("RM1 to RM4 lookups run again:", getCounters().resolver.lookupsRunAgain - ranAgain);
      },

      async relink() {
        // A link to a package is pointed at another version after a file of the package missed,
        // as an install of that version does. The old retry kept the miss, and the version that
        // the link named first. Now the run after the miss asks again where the link leads: it
        // finds the file in the new version, where require() can load it, and the package is the
        // new one from then on.
        const load = (label, from, specifier) => {
          try {
            console.log(label, "OK", from(specifier).v);
          } catch (e) {
            console.log(label, "ERR", e.code);
          }
        };
        for (const version of ["v1", "v2"]) {
          const store = path.join("relink", "store", version);
          write(path.join(store, "package.json"), JSON.stringify({ name: "pkg", main: "./index.js" }));
          write(path.join(store, "index.js"), "");
        }
        write(path.join("relink", "store", "v2", "extra.js"), "module.exports = { v: 2 };");
        fs.mkdirSync(path.join("relink", "node_modules"));
        const link = path.join("relink", nm("pkg"));
        fs.symlinkSync(path.resolve("relink", "store", "v1"), link, "junction");
        const relink = requireFrom("relink");
        res("RL1", () => relink.resolve("pkg"));
        res("RL2", () => relink.resolve("pkg/extra.js"));
        fs.renameSync(link, link + "-old");
        fs.symlinkSync(path.resolve("relink", "store", "v2"), link, "junction");
        res("RL3", () => relink.resolve("pkg/extra.js"));
        load("RL4", relink, "pkg/extra.js");
        res("RL5", () => relink.resolve("pkg"));
      },

      async spelling() {
        // A name asked for in another case than it has on disk, and a name whose case changed on
        // disk. The old retry answered these as a new process does: it dropped the importer's
        // directory. Now the run after a miss reads the listing again in place, and that keeps an
        // entry only under the spelling that the directory has.
        const { getCounters } = require("bun:internal-for-testing");
        // Prints how many lookups ran again since the last call: each one that missed at first, once.
        let ranAgain = getCounters().resolver.lookupsRunAgain;
        const counted = rows => {
          const now = getCounters().resolver.lookupsRunAgain;
          console.log(rows, "lookups run again:", now - ranAgain);
          ranAgain = now;
        };
        // foo.js is written after ./Foo.js missed. A listing folds the case of a name.
        fs.mkdirSync("spell");
        const spell = requireFrom("spell");
        res("FO1", () => spell.resolve("./Foo.js"));
        write(path.join("spell", "foo.js"), "");
        res("FO2", () => spell.resolve("./Foo.js"));
        counted("FO1 and FO2");

        // bar.js is renamed to Bar.js after its directory was listed. The next miss in that
        // directory reads the name again.
        write(path.join("rename", "bar.js"), "module.exports = { v: 'bar' };");
        const rename = requireFrom("rename");
        res("CR1", () => rename.resolve("./bar.js"));
        fs.renameSync(path.join("rename", "bar.js"), path.join("rename", "Bar.js"));
        res("CR2", () => rename.resolve("./nope.js"));
        res("CR3", () => rename.resolve("./Bar.js"));
        res("CR4", () => rename.resolve("./bar.js"));
        try {
          console.log("CR5 OK", rename("./Bar.js").v);
        } catch (e) {
          console.log("CR5 ERR", e.code);
        }
        counted("CR1 to CR5");
      },

      async edits() {
        // An alias is added to a config file after a lookup of it missed. The file is next to
        // the importer (N) or two directories above it (A). The old retry read again the
        // directory that the text of the specifier names: it saw N1 and N3 only.
        const paths = map => ({ compilerOptions: { baseUrl: ".", paths: map } });
        const imports = map => ({ name: "app", imports: map });
        const rows = [
          ["1", "tsconfig.json", paths, { "@a": ["./lib/a.js"] }, { "@b": ["./lib/b.js"] }, "@b"],
          ["2", "tsconfig.json", paths, { "@a": ["./lib/a.js"] }, { "@alias/*": ["./lib/*"] }, "@alias/b.js"],
          ["3", "package.json", imports, { "#a": "./lib/a.js" }, { "#b": "./lib/b.js" }, "#b"],
          ["4", "package.json", imports, { "#a": "./lib/a.js" }, { "#int/*": "./lib/*" }, "#int/b.js"],
        ];
        for (const [where, importer] of [["N", ""], ["A", path.join("src", "app")]]) {
          for (const [n, file, config, first, added, specifier] of rows) {
            const top = path.join("edits", where + n);
            write(path.join(top, file), JSON.stringify(config(first)));
            write(path.join(top, "lib", "b.js"), "");
            fs.mkdirSync(path.join(top, importer), { recursive: true });
            const from = requireFrom(path.join(top, importer));
            res(where + n + " before", () => from.resolve(specifier));
            write(path.join(top, file), JSON.stringify(config({ ...first, ...added })));
            res(where + n + " after", () => from.resolve(specifier));
          }
        }
      },

      async issues() {
        // #12372, from the ways to ask that the tsconfig group does not use.
        await import("./ts/apis.mjs");

        // #25370: a package that appears in a node_modules that was listed, asked for from a
        // directory far below it.
        const chunks = path.join("next", ".next", "dev", "server", "chunks", "ssr");
        write(path.join("next", nm("other", "index.js")), "");
        fs.mkdirSync(chunks, { recursive: true });
        const chunk = requireFrom(chunks);
        res("T1", () => chunk.resolve("other"));
        res("T2", () => chunk.resolve("payload-abc123"));
        write(path.join("next", nm("payload-abc123", "package.json")), JSON.stringify({ name: "payload-abc123", main: "i.js" }));
        write(path.join("next", nm("payload-abc123", "i.js")), "");
        res("T3", () => chunk.resolve("payload-abc123"));
        // The same for a scoped name that a directory between the two links to.
        const scope = path.join("next", ".next", nm("@aws-sdk"));
        res("T4", () => chunk.resolve("@aws-sdk/client-s3-ecbef8e33fd0b8f0"));
        fs.mkdirSync(scope, { recursive: true });
        fs.symlinkSync(path.resolve("next", nm("other")), path.join(scope, "client-s3-ecbef8e33fd0b8f0"), "junction");
        res("T5", () => chunk.resolve("@aws-sdk/client-s3-ecbef8e33fd0b8f0"));

        // #47608: a file added to a directory of node_modules after another file of it was imported.
        write(nm("@pk", "a.ts"), "export const v = 'a';");
        await t("F1", "@pk/a.ts");
        write(nm("@pk", "b.ts"), "export const v = 'b';");
        await t("F2", "@pk/b.ts");

        // #47457: a relative request with "paths", whose first directory does not exist.
        fs.mkdirSync("nx");
        const options = { paths: [path.resolve("nx", ".nx", "installation"), path.resolve("nx")] };
        res("X1", () => require.resolve("./inference.cjs", options));
        write(path.join("nx", "inference.cjs"), "");
        res("X2", () => require.resolve("./inference.cjs", options));
      },

      async workeralias() {
        // The entry point of a Worker is looked up from the working directory, which is ts/ here:
        // its tsconfig.json maps "@/*" onto that directory.
        const run = (label, specifier) =>
          new Promise(done => {
            // The Worker of the web takes any specifier. The one of node:worker_threads takes a path.
            const worker = new globalThis.Worker(specifier);
            worker.onmessage = event => {
              console.log(label, "OK", event.data);
              worker.terminate();
              done();
            };
            worker.onerror = event => {
              console.log(label, "ERR", event.message.split("\\n")[0]);
              done();
            };
          });
        fs.mkdirSync("workers");
        await run("WK1", "@/workers/late.mjs");
        write(path.join("workers", "late.mjs"), "postMessage('ran');");
        await run("WK2", "@/workers/late.mjs");
      },

      async macro() {
        // A module that import() loads is transpiled by a job of the thread pool, which works on
        // a copy of this thread's resolver. The job looks up the macro that the module imports:
        // a file written after its directory was listed. The job finds it while this thread
        // looks up files that are not there: each of those lookups misses and runs again.
        const jobs = 8;
        const here = path.resolve("macro");
        for (let i = 0; i < jobs; i++) {
          write(path.join(here, "macros" + i, "other.ts"), "");
          write(
            path.join(here, "mods", "m" + i + ".ts"),
            'import { v } from "../macros' + i + '/mac.ts" with { type: "macro" };\\nexport const x = v();\\n',
          );
          Bun.resolveSync("./macros" + i + "/other.ts", here);
        }
        for (let i = 0; i < jobs; i++) write(path.join(here, "macros" + i, "mac.ts"), "export function v() { return 42; }");
        const found = [];
        let missed = 0;
        for (let i = 0; i < jobs; i++) {
          found.push(import(path.join(here, "mods", "m" + i + ".ts")).then(module => module.x, error => error.message));
          for (let k = 0; k < 5; k++) {
            try {
              Bun.resolveSync("./nope-" + i + "-" + k + ".ts", here);
            } catch {
              missed++;
            }
          }
        }
        console.log("what the macros of " + jobs + " jobs returned:", (await Promise.all(found)).join(" "));
        console.log("lookups that this thread missed meanwhile:", missed);
      },

      async inflight() {
        // A build that is under way. A plugin writes the module that the build asks for and declines,
        // so the build looks the module up itself, in a directory that it listed before the module
        // was there. A build takes a listing of its own as it is, and looks up once more what it
        // does not find, unless the program handles the miss.
        // "probe": the plugin first looks the module up at the runtime. That lookup misses and runs
        // again, so the listing is no longer the build's own.
        // "handled": the import sits in a try block. A build that does not find such a module
        // succeeds, and prints the require() as an expression that throws: the bundle never loads
        // the module.
        const { getCounters } = require("bun:internal-for-testing");
        const run = async (label, { handled, probe, made = "gen.js", asked = "./gen.js", before = "" }) => {
          const dir = path.join(root, "inflight", label);
          const load = "require(" + JSON.stringify(asked) + ").v";
          const use = handled
            ? "let v; try { v = " + load + "; } catch { v = 'ABSENT'; } console.log(v);"
            : "console.log(" + load + ");";
          write(path.join(dir, "ent.js"), before + use);
          const from = requireFrom(dir);
          const writesThenDeclines = {
            name: "writes-then-declines",
            setup(build) {
              build.onResolve({ filter: /gen(\\.js|\\/b\\.js)?$/ }, () => {
                if (probe) {
                  try {
                    from.resolve(asked);
                  } catch {}
                }
                write(path.join(dir, made), "exports.v = 'MADE BY THE PLUGIN';");
                return undefined;
              });
            },
          };
          const ranAgain = getCounters().resolver.lookupsRunAgain;
          const built = await Bun.build({
            entrypoints: [path.join(dir, "ent.js")],
            plugins: [writesThenDeclines],
            target: "bun",
            throw: false,
          });
          const text = built.success ? await built.outputs[0].text() : "";
          // The expression that the build prints for a handled require() that it did not find. The
          // name is part of it: the require() in "before" is printed in the same way.
          const throws = '"Cannot require module "+' + JSON.stringify(asked);
          const answer = !built.success
            ? "ERR " + built.logs.map(log => log.message).join("|")
            : text.includes("MADE BY THE PLUGIN")
              ? "bundled"
              : text.includes(throws)
                ? "not bundled, the require throws"
                : "not bundled";
          console.log(label, answer + ", lookups run again", getCounters().resolver.lookupsRunAgain - ranAgain);
        };
        // The first build of the process too: no build comes before IF1.
        await run("IF1", { handled: false, probe: true });
        await run("IF2", { handled: true, probe: true });
        await run("IF3", { handled: false, probe: false });
        await run("IF4", { handled: true, probe: false });
        // A directory that the build has looked for, and that the plugin makes. ID1 asks for a
        // file in it, ID2 and ID3 for the directory itself.
        const early = "try { require('./gen/a.js'); } catch {}\\n";
        await run("ID1", { handled: true, probe: false, made: "gen/b.js", asked: "./gen/b.js", before: early });
        await run("ID2", { handled: true, probe: false, made: "gen/index.js", asked: "./gen", before: early });
        await run("ID3", { handled: false, probe: false, made: "gen/index.js", asked: "./gen", before: early });
        // A loader of optional modules, as a package with a native binding has one. It has each
        // form of an import whose miss the program handles, and only its last module is there:
        // the build misses the five others and looks none of them up again.
        const loader = path.join(root, "inflight", "HD", "loader.js");
        write(path.join(path.dirname(loader), "node_modules", "real", "index.js"), "exports.real = true;");
        const imports = [
          'try { exports.a = require("./binding.linux-x64.node"); } catch {}',
          'try { exports.b = require("@never-installed/binding-linux-x64"); } catch {}',
          'try { exports.c = require.resolve("never-installed"); } catch {}',
          'exports.d = (async () => { try { return await import("./late.mjs"); } catch {} })();',
          'exports.e = import("./later.mjs").catch(() => null);',
          'exports.real = require("real");',
        ];
        write(loader, imports.join("\\n"));
        const ranAgain = getCounters().resolver.lookupsRunAgain;
        const built = await Bun.build({ entrypoints: [loader], target: "bun", throw: false });
        const answer = built.success ? "built" : "ERR " + built.logs.map(log => log.message).join("|");
        console.log("HD", answer + ", lookups run again", getCounters().resolver.lookupsRunAgain - ranAgain);
      },

      async build() {
        // Bun.build() shares the cache across calls. Shapes of "installed after the
        // first build failed", and one of "written while the build runs".
        const { getCounters } = require("bun:internal-for-testing");
        // build(), and how many lookups ran again after a miss meanwhile.
        const buildCounted = async (label, entry, plugins) => {
          const before = getCounters().resolver.lookupsRunAgain;
          await build(label, entry, plugins);
          console.log(label, "lookups run again:", getCounters().resolver.lookupsRunAgain - before);
        };
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
        // package.json existed, its main file did not. Bun found this one before it ran a
        // lookup again after a miss: a build asks the disk again about each listing that an
        // earlier build read. So G3b misses nothing, and no lookup runs again.
        write(path.join("g3", "ent.ts"), 'import { v } from "dpk3"; console.log(v);');
        write(path.join("g3", "node_modules", "dpk3", "package.json"), '{"name":"dpk3","main":"i.js"}');
        await build("G3a", path.join("g3", "ent.ts"));
        write(path.join("g3", "node_modules", "dpk3", "i.js"), "export const v = 42;");
        await buildCounted("G3b", path.join("g3", "ent.ts"));
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
        // A CSS url() with a fragment: looked up as written, then without the fragment. Bun
        // found this one before too, for the same reason: no lookup runs again in G6b.
        const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
        write(path.join("g6", "ent.css"), 'a { background: url("./late.svg#frag"); }');
        await build("G6a", path.join("g6", "ent.css"));
        write(path.join("g6", "late.svg"), svg);
        await buildCounted("G6b", path.join("g6", "ent.css"));
        // The same within one build, which listed the directory for its entry point: a plugin
        // writes the file when the build asks for it, and declines. The lookup misses as written
        // and without the fragment, and the one run after the miss has to make both tries again:
        // only the second one finds the file.
        const writing = [
          {
            name: "writing",
            setup: b => b.onResolve({ filter: /late[.]svg/ }, () => write(path.join("g7", "late.svg"), svg)),
          },
        ];
        write(path.join("g7", "ent.css"), 'a { background: url("./late.svg#frag"); }');
        await buildCounted("G7", path.join("g7", "ent.css"), writing);
      },
    };

    await groups[process.argv[2]]();
  `,
};

async function runGroup(
  group: string,
  env: (dir: string) => Record<string, string> = () => ({}),
  setup: (dir: string) => void = () => {},
  // Where the process starts, and its flags.
  start: (dir: string) => { cwd: string; flags: string[] } = dir => ({ cwd: dir, flags: [] }),
  // The user that the process runs as: the one of the test, unless this names another. Disposed of after the process.
  user: (dir: string) => { uid?: number; gid?: number } & Disposable = () => ({ [Symbol.dispose]() {} }),
) {
  using dir = tempDir("dir-cache-retry", files);
  setup(String(dir));
  const { cwd, flags } = start(String(dir));
  using runAs = user(String(dir));
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...flags, join(String(dir), "main.mjs"), group],
    env: { ...bunEnv, ...env(String(dir)) },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    uid: runAs.uid,
    gid: runAs.gid,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr: stderr.trim(), exitCode };
}

describe.concurrent("a failed resolution sees packages and files created after the miss", () => {
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

  test("a package symlinked in after the miss, and a link whose target is written later", async () => {
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
});

describe.concurrent("a failed resolution sees them from each way to ask the resolver", () => {
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

  test("a file URL through a symlinked root, with no importer", async () => {
    const linkedRoot = (dir: string) => {
      mkdirSync(join(dir, "private", "var", "folders"), { recursive: true });
      symlinkSync(join("private", "var"), join(dir, "var"), "junction");
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
      G3b lookups run again: 0
      G4a ERR Could not resolve: "dpk4". Maybe you need to "bun install"?
      G4b OK 1
      G5a ERR ModuleNotFound resolving "dpk5" (entry point)
      G5b OK 1
      G6a ERR Could not resolve: "./late.svg#frag"
      G6b OK 1
      G6b lookups run again: 0
      G7 OK 1
      G7 lookups run again: 1"
      ,
      }
    `);
  });

  test("a build under way looks up again what it does not find, unless the program handles the miss", async () => {
    expect(await runGroup("inflight")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        // The plugin's lookup ran again, and left a listing that is not the build's own: the build reads it again.
        "IF1 bundled, lookups run again 1",
        "IF2 bundled, lookups run again 1",
        // The listing is the build's own: its lookup misses, and runs again unless the program handles the miss.
        "IF3 bundled, lookups run again 1",
        "IF4 not bundled, the require throws, lookups run again 0",
        // A directory that was not there is opened again by each lookup of a build.
        "ID1 bundled, lookups run again 0",
        // The build listed the directory above without the new one, and takes its own listing as it is.
        "ID2 not bundled, the require throws, lookups run again 0",
        "ID3 bundled, lookups run again 1",
        // Each form of an import whose miss the program handles: five misses, and no lookup runs again.
        "HD built, lookups run again 0",
      ].join("\n"),
    });
  });
});

describe.concurrent("a failed resolution answers as a new process does", () => {
  test("a node_modules or a package.json removed next to the importer after the miss", async () => {
    expect(await runGroup("changed")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "RM1 ERR MODULE_NOT_FOUND",
        "RM2 OK r1/node_modules/pkg/index.js",
        "RM3 ERR MODULE_NOT_FOUND",
        "RM4 OK r2/node_modules/pkg/index.js",
        // The old retry answered the four lines above too. It has no such count.
        "RM1 to RM4 lookups run again: 4",
      ].join("\n"),
    });
  });

  test("a link to a package pointed at another version after a file of the package missed", async () => {
    expect(await runGroup("relink")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "RL1 OK relink/store/v1/index.js",
        "RL2 ERR MODULE_NOT_FOUND",
        // The old retry answered MODULE_NOT_FOUND to the next two lines, and the first version to the last one.
        "RL3 OK relink/store/v2/extra.js",
        "RL4 OK 2",
        "RL5 OK relink/store/v2/index.js",
      ].join("\n"),
    });
  });

  test("a name asked for in another case, and a file renamed to another case of its name", async () => {
    expect(await runGroup("spelling")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "FO1 ERR MODULE_NOT_FOUND",
        "FO2 OK spell/foo.js",
        // The old retry answered each line but the two counts. It has no such count.
        "FO1 and FO2 lookups run again: 2",
        "CR1 OK rename/bar.js",
        "CR2 ERR MODULE_NOT_FOUND",
        "CR3 OK rename/Bar.js",
        "CR4 OK rename/Bar.js",
        "CR5 OK bar",
        // CR2 alone: it listed the directory again, so the lookups after it found the new name at once.
        "CR1 to CR5 lookups run again: 1",
      ].join("\n"),
    });
  });

  test("an alias added to a config file next to the importer or above it", async () => {
    const rows = ["N1", "N2", "N3", "N4", "A1", "A2", "A3", "A4"];
    expect(await runGroup("edits")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: rows
        .flatMap(row => [`${row} before ERR MODULE_NOT_FOUND`, `${row} after OK edits/${row}/lib/b.js`])
        .join("\n"),
    });
  });

  test("the reported lookups, from the other ways to ask the resolver", async () => {
    expect(await runGroup("issues")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "require.resolve() OK late-1.cjs",
        "require.resolve() with paths OK late-2.cjs",
        "import.meta.resolve() OK late-3.cjs",
        "Bun.resolveSync() OK late-4.cjs",
        "Bun.resolve() OK late-5.cjs",
        "createRequire() OK late-6.cjs",
        "createRequire().resolve() OK late-7.cjs",
        "T1 OK next/node_modules/other/index.js",
        "T2 ERR MODULE_NOT_FOUND",
        "T3 OK next/node_modules/payload-abc123/i.js",
        "T4 ERR MODULE_NOT_FOUND",
        "T5 OK next/node_modules/other/index.js",
        "F1 OK a",
        "F2 OK b",
        "X1 ERR MODULE_NOT_FOUND",
        "X2 OK nx/inference.cjs",
      ].join("\n"),
    });
  });

  test("new Worker() of a tsconfig alias whose file is written after the miss", async () => {
    const inTs = (dir: string) => ({ cwd: join(dir, "ts"), flags: [] });
    expect(await runGroup("workeralias", undefined, undefined, inTs)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: ['WK1 ERR BuildMessage: ModuleNotFound resolving "@/workers/late.mjs" (entry point)', "WK2 OK ran"].join(
        "\n",
      ),
    });
  });

  test("a macro that a transpile job looks up with its copy of the resolver", async () => {
    const { stdout, stderr, exitCode } = await runGroup("macro");
    // A debug build also logs "[macro] call v" to stdout.
    const lines = stdout.split("\n").filter(line => !line.startsWith("[macro]"));
    expect({ lines, stderr, exitCode }).toEqual({
      lines: [
        "what the macros of 8 jobs returned: 42 42 42 42 42 42 42 42",
        "lookups that this thread missed meanwhile: 40",
      ],
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("a failed resolution checks again the config files and links it read", () => {
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
      Y16 ERR MODULE_NOT_FOUND
      YR1 OK c7/a.cjs
      YR2 ERR MODULE_NOT_FOUND
      YR3 OK c7/b.cjs
      YA1 OK c8/a.cjs
      YA2 ERR MODULE_NOT_FOUND
      YA3 OK c8/b.cjs"
      ,
      }
    `);
  });

  test("a lookup through links to directories that were read again", async () => {
    expect(await runGroup("links")).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "LA1 ERR MODULE_NOT_FOUND
      LA2 OK two/impl.cjs
      LA3 OK two/impl.cjs
      LB1 ERR MODULE_NOT_FOUND
      LB2 OK three/impl.cjs
      LB3 OK three/impl.cjs
      LP1 ERR MODULE_NOT_FOUND
      LP2 OK r1/real.cjs
      LP3 ERR MODULE_NOT_FOUND
      LP4 OK r2/real.cjs
      LT1 ERR MODULE_NOT_FOUND
      LT2 OK r3/real.cjs
      LT3 OK r3/real.cjs
      LC1 ERR MODULE_NOT_FOUND
      LC2 OK q/src/real.cjs
      LS1 ERR MODULE_NOT_FOUND
      LS2 OK w/lib/old.cjs
      LS3 OK w/lib/new.cjs
      LN1 ERR MODULE_NOT_FOUND
      LN2 OK n/lib.cjs
      LN3 OK n/lib.cjs
      LO1 ERR MODULE_NOT_FOUND
      LO2 ERR MODULE_NOT_FOUND
      LO3 OK o/b/lib.cjs
      LO4 OK o/b/lib.cjs
      LG1 ERR MODULE_NOT_FOUND
      LG2 OK g/b/lib.cjs"
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
});

describe.concurrent("a failed resolution checks again what else it read from the caches", () => {
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

  // From the root of the file system too: the root used to get two cache records when it was the
  // directory asked for, the second linked to the first.
  test.each([
    ["the project", (dir: string) => ({ cwd: dir, flags: [] })],
    // No package is installed for a miss where no node_modules is above the working directory.
    ["the root of the file system", (dir: string) => ({ cwd: parse(dir).root, flags: ["--no-install"] })],
  ])("an unchanged miss runs its lookup again once and makes no record or listing, started in %s", async (_, start) => {
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
      symlinkSync("nowhere.cjs", join(dir, "s7.cjs"), "file");
    };
    expect(await runGroup("steady", undefined, steadyFiles, start)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        "Z1 ERR MODULE_NOT_FOUND",
        "Z2 ERR MODULE_NOT_FOUND",
        "Z3 ERR MODULE_NOT_FOUND",
        "Z4 ERR MODULE_NOT_FOUND",
        "Z5 ERR MODULE_NOT_FOUND",
        "Z6 ERR MODULE_NOT_FOUND",
        "Z7 ERR MODULE_NOT_FOUND",
        "Z8 ERR MODULE_NOT_FOUND",
        "Z9 ERR MODULE_NOT_FOUND",
        "Z10 ERR MODULE_NOT_FOUND",
        "lookups run again by 200 more misses: 200",
        "new directory records by 200 more misses: 0",
        "new listings by 200 more misses: 0",
        // Windows lists a directory without its identity, and reads each listing again.
        ...(isWindows ? [] : ["listings read again by 200 more misses: 0"]),
      ].join("\n"),
    });
  });

  // Each file ends where a key or a value is due. Reading it logs what is missing, once, and the record of its
  // directory keeps that: every run of a miss reports it, the first one and each one after it.
  test("an unchanged miss reports each config file that does not parse and makes no record or listing", async () => {
    const unparsedFiles = (dir: string) => {
      const tree = {
        "up1/package.json": `{ "name": "up1", `,
        "up2/tsconfig.json": `{ "compilerOptions": `,
        "up3/base.json": `{ "compilerOptions": `,
        "up3/tsconfig.json": JSON.stringify({ extends: "./base.json" }),
        "up4/package.json": `{ "name": "up4", `,
        "up5/node_modules/pkg/package.json": `{ "name": "pkg", "main": `,
        "up5/node_modules/pkg/real.cjs": "",
        "up6/package.json": `{ "name": "up6", `,
        "up6/src/tsconfig.json": `{ "compilerOptions": `,
      };
      for (const [file, contents] of Object.entries(tree)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), contents);
      }
      mkdirSync(join(dir, "up4", "src"));
    };
    const noKey = (file: string) => `note: Expected string but found end of file at <dir>/${file}`;
    const noValue = (file: string) => `note: Unexpected end of file at <dir>/${file}`;
    const labels = ["UP1", "UP2", "UP3", "UP4", "UP5", "UP6", "UP7"];
    expect(await runGroup("unparsed", undefined, unparsedFiles)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: [
        ...labels.map(label => `${label} ERR MODULE_NOT_FOUND`),
        "lookups run again by 140 more misses: 140",
        "new directory records by 140 more misses: 0",
        "new listings by 140 more misses: 0",
        // Windows lists a directory without its identity, and reads each listing again.
        ...(isWindows ? [] : ["listings read again by 140 more misses: 0"]),
        `UP1 reported ${noKey("up1/package.json:1:17")}`,
        `UP2 reported ${noKey("up1/package.json:1:17")}`,
        `UP3 reported ${noValue("up2/tsconfig.json:1:21")}`,
        `UP4 reported ${noValue("up3/base.json:1:21")}`,
        `UP5 reported ${noKey("up4/package.json:1:17")}`,
        `UP6 reported ${noValue("up5/node_modules/pkg/package.json:1:25")}`,
        // Each file once, the one above the importer first, as in a process that reads them for the first time.
        `UP7 reported ${noKey("up6/package.json:1:17")}, ${noValue("up6/src/tsconfig.json:1:21")}`,
      ].join("\n"),
    });
  });

  // The mode of a directory does not stop the superuser, so under it the fixture runs as another user. Windows
  // has no such mode. Serial: `unprivilegedSpawnOptions` may change and restore the modes of the directories
  // above the test's own.
  test.serial.skipIf(isWindows)(
    "an unchanged miss below a directory that can be entered but not listed makes no record or listing",
    async () => {
      const unlistableFiles = (dir: string) => {
        mkdirSync(join(dir, "xonly", "node_modules", "held"), { recursive: true });
        writeFileSync(join(dir, "xonly", "node_modules", "held", "index.js"), "");
        mkdirSync(join(dir, "xonly", "proj", "src"), { recursive: true });
        writeFileSync(join(dir, "xonly", "proj", "package.json"), JSON.stringify({ name: "proj" }));
      };
      // The user of the fixture can enter "xonly" and cannot list it, until the fixture is removed.
      const cannotList = (dir: string) => {
        const user = unprivilegedSpawnOptions(dir);
        chmodSync(join(dir, "xonly"), 0o111);
        return {
          uid: user.uid,
          gid: user.gid,
          [Symbol.dispose]() {
            chmodSync(join(dir, "xonly"), 0o755);
            user[Symbol.dispose]();
          },
        };
      };
      expect(await runGroup("unlistable", undefined, unlistableFiles, undefined, cannotList)).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: [
          "XA ERR MODULE_NOT_FOUND",
          "XB ERR MODULE_NOT_FOUND",
          "XC ERR MODULE_NOT_FOUND",
          "XD ERR MODULE_NOT_FOUND",
          "lookups run again by 80 more misses: 80",
          "new directory records by 80 more misses: 0",
          "new listings by 80 more misses: 0",
          "listings read again by 80 more misses: 0",
        ].join("\n"),
      });
    },
  );
});

// A Worker takes more than a second to start in a debug build, so this one does not share
// the machine with the tests above.
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

// The old retry dropped one directory and looked up again only if that drop removed something.
// When another thread had dropped the directory first, the miss was final: "Cannot find module
// './gen0_3.mjs'" for a file that is there. The other thread is the watcher of `bun --hot` and
// `bun --watch`, which drops the directory of each change that it sees, or a Worker that missed
// in the same directory. These tests do not share the machine: each needs its threads at work.
describe("a module that is written and looked up at once, while another thread drops its directory", () => {
  const files = {
    "fresh.mjs": `
      import fs from "node:fs";
      import { createRequire } from "node:module";
      import path from "node:path";

      const here = import.meta.dirname;
      const require = createRequire(import.meta.url);

      // Writes new modules beside this file and looks each one up at once. Returns what failed.
      export async function writeAndLookUp(id, { others, lookups }) {
        const failed = [];
        const fresh = async (i, lookUp) => {
          const specifier = "./gen" + id + "_" + i + ".mjs";
          fs.writeFileSync(path.join(here, specifier), "export const v = " + i + ";");
          try {
            await lookUp(specifier);
          } catch (e) {
            failed.push(e.message.split("\\n")[0]);
          }
        };
        // As a program does it.
        for (let i = 0; i < 10; i++) await fresh(i, specifier => import(specifier));
        // Then with more directories to look in, which do not exist: a lookup is at work for
        // longer. Thread 0 reads this directory first. Thread 1 looks in most of the others
        // first. So one of them drops this directory while the other is still at work.
        const nowhere = Array.from({ length: others }, (_, i) => path.join(here, "nowhere", String(i)));
        const paths = id ? [...nowhere.slice(0, (others * 3) / 4), here] : [here, ...nowhere];
        for (let i = 10; i < 10 + lookups; i++) await fresh(i, specifier => require.resolve(specifier, { paths }));
        return failed;
      }
    `,
  };
  const run = async (flags: string[], entry: string) => {
    using dir = tempDir("dir-cache-retry-fresh", { ...files, "main.mjs": entry });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { failed: stdout.trim(), exitCode };
  };

  test("the watcher of bun --hot", async () => {
    const entry = `
      import { writeAndLookUp } from "./fresh.mjs";
      // A reload evaluates this file again while the first run is still at work.
      if (!globalThis.started) {
        globalThis.started = true;
        console.log(JSON.stringify(await writeAndLookUp(0, { others: 192, lookups: 96 })));
        process.exit(0);
      }
    `;
    expect(await run(["--hot", "--no-clear-screen"], entry)).toEqual({ failed: "[]", exitCode: 0 });
  });

  test("a Worker and the main thread", async () => {
    // A debug build takes a second to start the Worker, and its lookups are slow.
    const size = isDebug || isASAN ? { others: 48, lookups: 16 } : { others: 192, lookups: 256 };
    const entry = `
      import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
      import { writeAndLookUp } from "./fresh.mjs";
      if (isMainThread) {
        const up = new Int32Array(new SharedArrayBuffer(4));
        const theirs = new Promise((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: up });
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.once("exit", code => reject(new Error("worker exited with " + code + " before posting")));
        });
        // Both threads start when the Worker is up.
        Atomics.wait(up, 0, 0);
        const mine = await writeAndLookUp(0, ${JSON.stringify(size)});
        console.log(JSON.stringify([...mine, ...(await theirs)]));
      } else {
        Atomics.store(workerData, 0, 1);
        Atomics.notify(workerData, 0);
        parentPort.postMessage(await writeAndLookUp(1, ${JSON.stringify(size)}));
      }
    `;
    expect(await run([], entry)).toEqual({ failed: "[]", exitCode: 0 });
  });
});
