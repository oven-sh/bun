import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// The resolver caches every directory it reads, including the ones it did not
// find, for the life of the process and shares that cache between the runtime,
// every Worker, and every Bun.build() call. A lookup that failed because a
// file was not written yet used to stay failed after the file appeared: the
// retry only dropped the importer's own directory. Now a miss drops every
// directory the lookup read and resolves once more, and a module file that
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
  "main.mjs": `
    import fs from "node:fs";
    import path from "node:path";
    import { createRequire } from "node:module";
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

    const groups = {
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

async function runGroup(group: string) {
  using dir = tempDir("dir-cache-retry", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs", group],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr: stderr.trim(), exitCode };
}

describe.concurrent("a failed resolution sees files and packages created after the miss", () => {
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
