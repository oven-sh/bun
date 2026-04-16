import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import fs from "node:fs";
import net from "node:net";

// Two test files where the first leaks state and the second observes it.
// Under --isolate the second file must see a clean world.
const fixtures = {
  "a-leaker.test.ts": `
    import { test, expect } from "bun:test";

    test("leak global + server + interval", async () => {
      (globalThis as any).leakedFromA = "boom";

      const server = Bun.serve({ port: 0, fetch: () => new Response("hi") });
      (globalThis as any).leakedPort = server.port;

      setInterval(() => {
        (globalThis as any).intervalRan = ((globalThis as any).intervalRan ?? 0) + 1;
      }, 5).unref();

      expect(server.port).toBeGreaterThan(0);
    });
  `,
  "b-observer.test.ts": `
    import { test, expect } from "bun:test";

    test("globalThis is clean", () => {
      expect((globalThis as any).leakedFromA).toBeUndefined();
      expect((globalThis as any).leakedPort).toBeUndefined();
      expect((globalThis as any).intervalRan).toBeUndefined();
    });
  `,
};

async function runTests(dir: string, extraArgs: string[], files = ["./a-leaker.test.ts", "./b-observer.test.ts"]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs, ...files],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bun test --isolate", () => {
  test("without --isolate, leaked global is visible to next file", async () => {
    using dir = tempDir("isolate-off", fixtures);
    const { stderr, exitCode } = await runTests(String(dir), []);
    expect(stderr).toContain("(fail) globalThis is clean");
    expect(exitCode).not.toBe(0);
  });

  test("with --isolate, each file gets a fresh global", async () => {
    using dir = tempDir("isolate-on", fixtures);
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, --preload re-runs in each file's fresh global", async () => {
    using dir = tempDir("isolate-preload", {
      "preload.ts": `
        import { expect, beforeEach, beforeAll, afterAll } from "bun:test";
        expect.extend({
          toBeCustom() { return { pass: true, message: () => "" }; },
        });
        beforeEach(() => { (globalThis as any).__preloadRan = true; });
        beforeAll(() => { (globalThis as any).__beforeAllRan = ((globalThis as any).__beforeAllRan ?? 0) + 1; });
        afterAll(() => { (globalThis as any).__afterAllRan = true; });
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("preload state present in a", () => {
          expect((globalThis as any).__preloadRan).toBe(true);
          expect((globalThis as any).__beforeAllRan).toBe(1);
          (expect(1) as any).toBeCustom();
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("preload state present in b", () => {
          expect((globalThis as any).__preloadRan).toBe(true);
          expect((globalThis as any).__beforeAllRan).toBe(1);
          (expect(1) as any).toBeCustom();
        });
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--isolate", "--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("without --isolate, --preload still runs once (regression)", async () => {
    using dir = tempDir("isolate-preload-off", {
      "preload.ts": `
        import { beforeAll } from "bun:test";
        (globalThis as any).__preloadEvals = ((globalThis as any).__preloadEvals ?? 0) + 1;
        beforeAll(() => { (globalThis as any).__beforeAllRan = ((globalThis as any).__beforeAllRan ?? 0) + 1; });
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("a", () => {
          expect((globalThis as any).__preloadEvals).toBe(1);
          expect((globalThis as any).__beforeAllRan).toBe(1);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("b", () => {
          expect((globalThis as any).__preloadEvals).toBe(1);
          expect((globalThis as any).__beforeAllRan).toBe(1);
        });
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, module state is not shared between files", async () => {
    using dir = tempDir("isolate-modules", {
      "shared.ts": `export let counter = { n: 0 };`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { counter } from "./shared";
        test("bump", () => { counter.n++; expect(counter.n).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { counter } from "./shared";
        test("fresh", () => { expect(counter.n).toBe(0); });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, leaked outbound socket is closed before next file", async () => {
    using dir = tempDir("isolate-socket", {
      "a-connect.test.ts": `
        import { test, expect } from "bun:test";
        import net from "node:net";

        test("leak a net.Socket", async () => {
          const port = Number(process.env.PORT!);
          const sock = net.connect(port, "127.0.0.1");
          await new Promise<void>((resolve, reject) => {
            sock.once("connect", () => resolve());
            sock.once("error", reject);
          });
          expect(sock.readyState).toBe("open");
          // intentionally not closing sock
        });
      `,
      "b-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("server saw the disconnect", async () => {
          const closeFile = process.env.CLOSE_FILE!;
          for (let i = 0; i < 200; i++) {
            if (fs.existsSync(closeFile)) break;
            await Bun.sleep(10);
          }
          expect(fs.existsSync(closeFile)).toBe(true);
        });
      `,
    });

    const closeFile = String(dir) + "/closed.txt";

    const server = net.createServer(sock => {
      sock.on("close", () => fs.writeFileSync(closeFile, "1"));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a-connect.test.ts", "./b-check.test.ts"],
        env: { ...bunEnv, PORT: String(port), CLOSE_FILE: closeFile },
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("with --isolate, leaked fs.watch is closed before next file", async () => {
    using dir = tempDir("isolate-fswatch", {
      "watched/.keep": "",
      "a-watch.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("leak an fs.watch", () => {
          const w = fs.watch(process.env.WATCH_DIR!, () => {
            fs.writeFileSync(process.env.FIRE_FILE!, "fired");
          });
          w.unref();
          expect(w).toBeTruthy();
          // intentionally not calling w.close()
        });
      `,
      "b-mutate.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("watcher from prior file does not fire", async () => {
          fs.writeFileSync(process.env.WATCH_DIR! + "/poke.txt", String(Date.now()));
          // Poll for up to 500ms; if the leaked watcher fires at any point in
          // this window the regression is caught (avoids a false pass when a
          // slow runner delivers the event after a fixed sleep).
          for (let i = 0; i < 25; i++) {
            if (fs.existsSync(process.env.FIRE_FILE!)) break;
            await Bun.sleep(20);
          }
          expect(fs.existsSync(process.env.FIRE_FILE!)).toBe(false);
        });
      `,
    });

    const watchDir = String(dir) + "/watched";
    const fireFile = String(dir) + "/fired.txt";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a-watch.test.ts", "./b-mutate.test.ts"],
      env: { ...bunEnv, WATCH_DIR: watchDir, FIRE_FILE: fireFile },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("leaked subprocesses are killed for every isolated file, not just the first", async () => {
    using dir = tempDir("isolate-subprocess", {
      "a-spawn.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        test("leak a sleeper from file A", () => {
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{}, 1e6)"], stdout: "ignore", stderr: "ignore" });
          fs.writeFileSync(process.env.PID_FILE_A!, String(child.pid));
          expect(child.pid).toBeGreaterThan(0);
        });
      `,
      "b-spawn.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        test("leak a sleeper from file B", () => {
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{}, 1e6)"], stdout: "ignore", stderr: "ignore" });
          fs.writeFileSync(process.env.PID_FILE_B!, String(child.pid));
          expect(child.pid).toBeGreaterThan(0);
        });
      `,
      "c-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        test("both prior subprocesses were killed by isolation", async () => {
          const pidA = Number(fs.readFileSync(process.env.PID_FILE_A!, "utf8"));
          const pidB = Number(fs.readFileSync(process.env.PID_FILE_B!, "utf8"));
          // auto_killer sends SIGTERM at swap; allow a moment for the OS to reap.
          for (let i = 0; i < 50 && (isAlive(pidA) || isAlive(pidB)); i++) await Bun.sleep(20);
          expect(isAlive(pidA)).toBe(false);
          expect(isAlive(pidB)).toBe(false);
        });
      `,
    });

    const pidA = String(dir) + "/pid-a.txt";
    const pidB = String(dir) + "/pid-b.txt";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a-spawn.test.ts", "./b-spawn.test.ts", "./c-check.test.ts"],
      env: { ...bunEnv, PID_FILE_A: pidA, PID_FILE_B: pidB },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});

// The eviction test below proves the SourceProvider cache is active (control:
// b sees stale v1 → cache hit) and that delete require.cache evicts it
// (treatment: b sees fresh v2). A/B timing was removed as flaky; this is the
// deterministic behavioral proof.
test("--isolate: delete require.cache evicts the SourceProvider cache", async () => {
  const sharedV1 = `export const v = "v1";\n`;
  const sharedV2 = `export const v = "v2";\n`;
  const aBody = (doDelete: boolean) => `
    import { test, expect } from "bun:test";
    import { writeFileSync } from "node:fs";
    test("a sees v1 then rewrites", async () => {
      const { v } = await import("./shared.ts");
      expect(v).toBe("v1");
      ${doDelete ? `delete require.cache[require.resolve("./shared.ts")];` : ``}
      writeFileSync(new URL("./shared.ts", import.meta.url), ${JSON.stringify(sharedV2)});
    });
  `;
  const bBody = (expected: "v1" | "v2") => `
    import { test, expect } from "bun:test";
    test("b sees ${expected}", async () => {
      const { v } = await import("./shared.ts");
      expect(v).toBe("${expected}");
    });
  `;

  // Control: without delete, the SourceProvider cache returns the v1 provider
  // even though the file on disk is now v2.
  {
    using dir = tempDir("isolate-spcache-evict-ctrl", {
      "shared.ts": sharedV1,
      "a.test.ts": aBody(false),
      "b.test.ts": bBody("v1"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }

  // With delete: the cache entry is evicted, so b's import re-transpiles and
  // sees v2 from disk.
  {
    using dir = tempDir("isolate-spcache-evict", {
      "shared.ts": sharedV1,
      "a.test.ts": aBody(true),
      "b.test.ts": bBody("v2"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }
});

test("--isolate: SourceProvider cache covers CommonJS modules", async () => {
  const sharedV1 = `module.exports = { v: "v1" };\n`;
  const sharedV2 = `module.exports = { v: "v2" };\n`;
  const aBody = (doDelete: boolean) => `
    const { test, expect } = require("bun:test");
    const { writeFileSync } = require("node:fs");
    const path = require("node:path");
    test("a sees v1 then rewrites", () => {
      const { v } = require("./shared.cjs");
      expect(v).toBe("v1");
      globalThis.__a_ran = true;
      ${doDelete ? `delete require.cache[require.resolve("./shared.cjs")];` : ``}
      writeFileSync(path.join(__dirname, "shared.cjs"), ${JSON.stringify(sharedV2)});
    });
  `;
  const bBody = (expected: "v1" | "v2") => `
    const { test, expect } = require("bun:test");
    test("b sees ${expected}", () => {
      // Under --isolate, a's global is gone; if b sees ${expected === "v1" ? "stale " : ""}v
      // it must be from the VM-level SourceProvider cache, not require.cache.
      expect(globalThis.__a_ran).toBeUndefined();
      const { v } = require("./shared.cjs");
      expect(v).toBe("${expected}");
    });
  `;
  // Same shared.cjs imported as ESM (import-CJS-from-ESM path).
  const cBody = (expected: "v1" | "v2") => `
    import { test, expect } from "bun:test";
    test("c (esm import of cjs) sees ${expected}", async () => {
      const mod = await import("./shared.cjs");
      expect(mod.default.v).toBe("${expected}");
    });
  `;

  // Control: without delete, the cached Program-type SourceProvider is reused
  // across files for both require() and import-of-CJS, so b and c see stale v1.
  {
    using dir = tempDir("isolate-spcache-cjs-ctrl", {
      "shared.cjs": sharedV1,
      "a.test.cjs": aBody(false),
      "b.test.cjs": bBody("v1"),
      "c.test.ts": cBody("v1"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.cjs", "./b.test.cjs", "./c.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }

  // With delete: b and c re-transpile and see v2.
  {
    using dir = tempDir("isolate-spcache-cjs", {
      "shared.cjs": sharedV1,
      "a.test.cjs": aBody(true),
      "b.test.cjs": bBody("v2"),
      "c.test.ts": cBody("v2"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.cjs", "./b.test.cjs", "./c.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("3 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }
});

test("--isolate: SourceProvider cache covers node_modules .mjs and type:commonjs packages", async () => {
  // Regression: insert was gated on tag == JavaScript || PackageJSONTypeModule,
  // so .mjs files from `"type":"module"` packages and .ts from `"type":"commonjs"`
  // packages (PackageJSONTypeCommonJS / ESM tags) bypassed the cache and were
  // re-transpiled on every isolated file. This test proves both now cache by
  // showing files 2-3 see stale v1 after file 1 rewrites disk to v2.
  const mkEsmPkg = (v: string) => `export const v = "${v}";\n`;
  const mkCjsPkg = (v: string) => `export const v: string = "${v}";\n`;
  const aBody = `
    import { test, expect } from "bun:test";
    import { writeFileSync } from "node:fs";
    import * as path from "node:path";
    import { v as esm } from "fake-esm-pkg";
    import { v as cjs } from "fake-cjs-pkg";
    test("a", () => {
      expect(esm).toBe("v1");
      expect(cjs).toBe("v1");
      globalThis.__a_ran = true;
      writeFileSync(path.join(process.cwd(), "node_modules/fake-esm-pkg/index.mjs"), ${JSON.stringify(mkEsmPkg("v2"))});
      writeFileSync(path.join(process.cwd(), "node_modules/fake-cjs-pkg/index.ts"), ${JSON.stringify(mkCjsPkg("v2"))});
    });
  `;
  const bcBody = (name: string) => `
    import { test, expect } from "bun:test";
    import { v as esm } from "fake-esm-pkg";
    import { v as cjs } from "fake-cjs-pkg";
    test("${name}", () => {
      expect(globalThis.__a_ran).toBeUndefined();
      expect(esm).toBe("v1");
      expect(cjs).toBe("v1");
    });
  `;

  using dir = tempDir("isolate-spcache-nodemod", {
    "node_modules/fake-esm-pkg/package.json": JSON.stringify({
      name: "fake-esm-pkg",
      type: "module",
      main: "./index.mjs",
    }),
    "node_modules/fake-esm-pkg/index.mjs": mkEsmPkg("v1"),
    "node_modules/fake-cjs-pkg/package.json": JSON.stringify({
      name: "fake-cjs-pkg",
      type: "commonjs",
      main: "./index.ts",
    }),
    "node_modules/fake-cjs-pkg/index.ts": mkCjsPkg("v1"),
    "a.test.ts": aBody,
    "b.test.ts": bcBody("b"),
    "c.test.ts": bcBody("c"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("3 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--isolate: cached SourceProvider's module_info rebuilds correct exports", async () => {
  // A wide module so the printer-generated module_info has thousands of
  // export entries. Under --isolate, file b hits the SourceProvider cache and
  // rebuilds JSModuleRecord from the cached module_info (Bun__analyzeTranspiledModule)
  // instead of re-parsing. If the record is wrong, named imports would be
  // undefined or the count would mismatch.
  const N = 2000;
  let big = "";
  for (let i = 0; i < N; i++) big += `export function f${i}(x){return x+${i};}\n`;
  big += `export const COUNT = ${N};\n`;

  const tBody = (name: string) => `
    import { test, expect } from "bun:test";
    import { f0, f1, f${N - 1}, COUNT } from "./big";
    import * as all from "./big";
    test("${name}", () => {
      expect(f0(1)).toBe(1);
      expect(f1(1)).toBe(2);
      expect(f${N - 1}(1)).toBe(${N});
      expect(COUNT).toBe(${N});
      expect(Object.keys(all).length).toBe(${N + 1});
    });
  `;

  using dir = tempDir("isolate-module-info", {
    "big.ts": big,
    "a.test.ts": tBody("a"),
    "b.test.ts": tBody("b"),
    "c.test.ts": tBody("c"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("3 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--isolate: cached module_info handles `import * as ns; export { ns }` as a Namespace export", async () => {
  // The zod pattern: re-exporting a namespace import binding. Bun's module_info
  // must record this as a [Namespace] export entry (not [Local]) so the cached
  // analyze result matches JSC's ModuleAnalyzer. The debug build's
  // fallbackParse diff would print "BEGIN analyzeTranspiledModule" + a DIFF
  // and assert if they disagree.
  using dir = tempDir("isolate-ns-reexport", {
    "external.ts": `export const a = 1;\nexport const b = 2;\n`,
    "re.ts": `import * as ns from "./external";\nexport { ns };\nexport default ns;\nexport * from "./external";\n`,
    "t1.test.ts": `import {test,expect} from "bun:test";
import { ns } from "./re";
import def, * as all from "./re";
test("t1", () => {
  (globalThis as any).__t1_ran = true;
  expect(ns.a).toBe(1);
  expect(def.b).toBe(2);
  expect(all.ns.a).toBe(1);
  expect(all.a).toBe(1);
  expect(Object.keys(ns).sort()).toEqual(["a","b"]);
});
`,
    "t2.test.ts": `import {test,expect} from "bun:test";
import { ns } from "./re";
test("t2", () => {
  // Isolation sentinel: system bun ignores --isolate, so t2 would see t1's
  // global mutation and fail here. Ensures this test depends on --isolate.
  expect((globalThis as any).__t1_ran).toBeUndefined();
  expect(ns.a).toBe(1);
  expect(ns.b).toBe(2);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./t1.test.ts", "./t2.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("BEGIN analyzeTranspiledModule");
  expect(stderr).not.toContain("DIFF:");
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("--isolate: leaked AbortSignal.timeout does not fire in next file", async () => {
  using dir = tempDir("isolate-abort-timeout", {
    "a-leak.test.ts": `
      import { test, expect } from "bun:test";
      import { writeFileSync } from "fs";
      test("leak AbortSignal.timeout", () => {
        const s = AbortSignal.timeout(100);
        s.addEventListener("abort", () => writeFileSync(process.env.FIRE_FILE!, "fired"));
        // Keep the signal reachable so it isn't GC'd before the timer would
        // have fired.
        (globalThis as any).__abort_signal = s;
        (globalThis as any).__a_ran = true;
        expect(s.aborted).toBe(false);
      });
    `,
    "b-check.test.ts": `
      import { test, expect } from "bun:test";
      import { existsSync } from "fs";
      test("AbortSignal from prior file did not fire here", async () => {
        // Prove this file is isolated from a (fails under USE_SYSTEM_BUN=1).
        expect((globalThis as any).__a_ran).toBeUndefined();
        for (let i = 0; i < 30; i++) {
          if (existsSync(process.env.FIRE_FILE!)) break;
          await Bun.sleep(20);
        }
        expect(existsSync(process.env.FIRE_FILE!)).toBe(false);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a-leak.test.ts", "./b-check.test.ts"],
    env: { ...bunEnv, FIRE_FILE: String(dir) + "/fired.txt" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});
