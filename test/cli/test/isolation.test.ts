import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, normalizeBunSnapshot, tempDir } from "harness";
import fs from "node:fs";
import net from "node:net";

// Every case spawns at least one full `bun test --isolate` child; the heavy
// ones (8-file leak fixtures, 500-2000-export module_info modules) exceed the
// 5s default on debug/ASAN runners.
setDefaultTimeout(isASAN ? 120_000 : 30_000);

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

describe.concurrent("bun test --isolate", () => {
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

  test("with --isolate, a file's process.chdir() is undone before the next file", async () => {
    const cwdFixtures = {
      "a-chdir.test.ts": `
        import { test, expect } from "bun:test";
        import { tmpdir } from "node:os";
        test("chdir away", () => {
          process.chdir(tmpdir());
          expect(process.cwd()).not.toBe(import.meta.dir);
        });
      `,
      "b-cwd.test.ts": `
        import { test, expect } from "bun:test";
        import { realpathSync } from "node:fs";
        test("cwd is the fixture dir", () => {
          expect(realpathSync(process.cwd())).toBe(realpathSync(import.meta.dir));
        });
      `,
    };
    const files = ["./a-chdir.test.ts", "./b-cwd.test.ts"];

    using isolated = tempDir("isolate-cwd", cwdFixtures);
    const serial = await runTests(String(isolated), ["--isolate"], files);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(serial.exitCode).toBe(0);

    // One worker takes both files (scale-up gated), so the same restore runs
    // between files inside a --parallel worker.
    using parallel = tempDir("isolate-cwd-parallel", cwdFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", ...files],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
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

  test("with --isolate, leaked vi.useFakeTimers() is deactivated before next file", async () => {
    // Fake-timer state lives in the per-thread timer heap, not the JS global,
    // so a file that activates vi.useFakeTimers() and never restores real
    // timers (e.g. an it.failing that throws before useRealTimers()) used to
    // route the next file's setTimeout into the never-driven fake heap.
    // net.Server.listen() fires 'listening' via setTimeout, so such a file
    // would hang until its per-test timeout.
    const fakeTimerFixtures = {
      "a-fake.test.ts": `
        import { test, vi } from "bun:test";
        test("leak fake timers", () => {
          vi.useFakeTimers();
          setTimeout(() => {}, 1000);
          AbortSignal.timeout(1000);
          // intentionally never calling vi.useRealTimers()
        });
      `,
      "b-real.test.ts": `
        import { test, expect } from "bun:test";
        import { createServer } from "node:net";
        test("setTimeout fires and net.Server 'listening' emits", async () => {
          const fired = await new Promise<boolean>(resolve => {
            setTimeout(() => resolve(true), 1);
          });
          expect(fired).toBe(true);

          const server = createServer();
          const listened = await new Promise<boolean>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve(true));
          });
          server.close();
          expect(listened).toBe(true);
        });
      `,
    };
    const files = ["./a-fake.test.ts", "./b-real.test.ts"];

    using isolated = tempDir("isolate-fake-timers", fakeTimerFixtures);
    const serial = await runTests(String(isolated), ["--isolate", "--timeout=5000"], files);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("0 fail");
    expect(serial.exitCode).toBe(0);

    // One worker takes both files (scale-up gated) so the same reset runs
    // between files inside a --parallel worker.
    using parallel = tempDir("isolate-fake-timers-parallel", fakeTimerFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--timeout=5000", ...files],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("0 fail");
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
test.concurrent("--isolate: delete require.cache evicts the SourceProvider cache", async () => {
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

  // Control (without delete) and treatment (with delete) are independent — run
  // both subprocesses in parallel.
  await Promise.all([
    // Control: without delete, the SourceProvider cache returns the v1 provider
    // even though the file on disk is now v2.
    (async () => {
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
    })(),
    // With delete: the cache entry is evicted, so b's import re-transpiles and
    // sees v2 from disk.
    (async () => {
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
    })(),
  ]);
});

test.concurrent("--isolate: SourceProvider cache covers CommonJS modules", async () => {
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

  // Control and treatment are independent — run both subprocesses in parallel.
  await Promise.all([
    // Control: without delete, the cached Program-type SourceProvider is reused
    // across files for both require() and import-of-CJS, so b and c see stale v1.
    (async () => {
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
    })(),
    // With delete: b and c re-transpile and see v2.
    (async () => {
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
    })(),
  ]);
});

test.concurrent("--isolate: SourceProvider cache covers node_modules .mjs and type:commonjs packages", async () => {
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

test.concurrent("--isolate: cached SourceProvider's module_info rebuilds correct exports", async () => {
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

test.concurrent(
  "--isolate: cached module_info handles `import * as ns; export { ns }` as a Namespace export",
  async () => {
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
  },
);

test.concurrent("--isolate: leaked AbortSignal.timeout does not fire in next file", async () => {
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

// Each of these leaked handles used to pin its test file's ENTIRE global
// object (and therefore the file's module graph) for the rest of a
// `bun test --isolate` run, growing memory by one full global per file:
//
// - fs.watch: isolation teardown called FSWatcher.detach(), which never drops
//   the initial pending_activity_count ref, so hasPendingActivity() stayed
//   true forever and the GC could never collect the wrapper or its cached
//   listener closure.
// - Bun.serve: the swap blind-closed the listen socket at the uws layer; the
//   Server object never learned, kept hasListener() true, and its strong
//   js_value (fetch handler closure) pinned the global.
// - setTimeout/setInterval: generation-stale timers only self-cancelled when
//   they FIRED, so a module-scope long timer held a Strong on its wrapper
//   until the deadline (effectively forever for hour-scale timers).
//
// Each fixture runs 8 isolated files that leak one handle apiece, forces a
// full GC, and counts live GlobalObject cells. Pinned globals accumulate
// (the last file sees 8); collectable ones plateau (current + a lagging one
// or two).
describe.concurrent("--isolate: collects globals pinned by leaked handles", () => {
  const LEAK_FILE_COUNT = 8;

  function makeLeakFixture(dirt: string): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 1; i <= LEAK_FILE_COUNT; i++) {
      files[`file_${i}.test.js`] = `
        import { test, expect } from "bun:test";
        import { heapStats } from "bun:jsc";
        ${dirt}
        test("leak-${i}", () => {
          Bun.gc(true);
          Bun.gc(true);
          const globals = heapStats().objectTypeCounts.GlobalObject ?? 0;
          console.log("GLOBALS=" + globals);
          expect(globals).toBeGreaterThan(0);
        });
      `;
    }
    return files;
  }

  async function maxLiveGlobals(dir: string): Promise<number> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`${LEAK_FILE_COUNT} pass`);
    expect(exitCode).toBe(0);
    const counts = [...stdout.matchAll(/GLOBALS=(\d+)/g)].map(m => Number(m[1]));
    expect(counts).toHaveLength(LEAK_FILE_COUNT);
    return Math.max(...counts);
  }

  test("fs.watch left open", async () => {
    using dir = tempDir(
      "isolate-leak-watch",
      makeLeakFixture(`
        import fs from "node:fs";
        const watcher = fs.watch(import.meta.dir, () => {});
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("Bun.serve left running", async () => {
    using dir = tempDir(
      "isolate-leak-serve",
      makeLeakFixture(`
        const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("long setTimeout/setInterval left pending", async () => {
    using dir = tempDir(
      "isolate-leak-timers",
      makeLeakFixture(`
        setTimeout(() => {}, 3_600_000);
        setInterval(() => {}, 3_600_000);
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });
});

// fs.watchFile's StatWatcher is thread-safe-refcounted: the scheduler queue
// holds a ref that is dropped on the work-pool thread. After unwatchFile +
// GC of the JS wrapper, that queue ref is the LAST ref, so the watcher is
// freed off the JS thread — where the thread-local isolation registry is
// unreachable. The registry entry must therefore be removed in close() (JS
// thread), not in the refcount destructor; otherwise the file-boundary drain
// pops a dangling pointer and calls close() on freed memory (UAF, caught by
// ASAN).
test.concurrent(
  "--isolate: unwatchFile'd watcher freed on the work pool leaves no dangling registry entry",
  async () => {
    // The dance, per file:
    //   1. watchFile, then touch the file until the listener fires — proof the
    //      initial stat completed and the watcher sits in the scheduler queue
    //      (queue ref taken).
    //   2. unwatchFile (close: Strong self-ref downgraded) + Bun.gc (wrapper
    //      finalized: wrapper ref dropped).
    //   3. sleep past a few 10ms scheduler ticks so the work-pool callback pops
    //      the closed watcher and drops the queue ref — the last one — freeing
    //      the watcher on the work-pool thread. No JS-observable signal exists
    //      for that free, hence the bounded sleep.
    // The file boundary after each file then drains the isolation registry,
    // which must no longer reference the freed watcher.
    const raceFixture = `
    import { test } from "bun:test";
    import fs from "node:fs";
    import path from "node:path";

    test("unwatchFile then free on work pool", async () => {
      const target = path.join(import.meta.dir, "watched-" + path.basename(import.meta.path) + ".txt");
      for (let round = 0; round < 3; round++) {
        fs.writeFileSync(target, "0");
        await (async function arm() {
          const fired = Promise.withResolvers();
          fs.watchFile(target, { interval: 10 }, () => fired.resolve());
          const poker = setInterval(() => fs.writeFileSync(target, String(Math.random())), 10);
          await fired.promise;
          clearInterval(poker);
          fs.unwatchFile(target);
        })();
        Bun.gc(true);
        Bun.gc(true);
        await Bun.sleep(250);
      }
    });
  `;
    // Two identical files: the drain runs at the boundary BETWEEN files, so the
    // first file's registry is drained while the second exists to force it.
    using dir = tempDir("isolate-statwatcher-race", {
      "a.test.js": raceFixture,
      "b.test.js": raceFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  },
);

// The synchronous module-load path (require(esm), importSync) must attach the
// transpiler's ESM-record analysis (module_info) to the ResolvedSource under
// --isolate, exactly like the async path does. module_info is what turns the
// cached SourceProvider into a BunTranspiledModule, letting every later file
// rebuild the module record from the cache instead of re-running JSC's parser
// over the transpiled source in its fresh global (CPU + transient allocations
// per file; ~1.2s/file for a 3000-export module in a debug build). Run 1
// exercises the fresh-transpile branch; run 2 hits the on-disk
// RuntimeTranspilerCache entry (esm_record branch).
test.concurrent("--isolate: require(esm) caches a BunTranspiledModule SourceProvider", async () => {
  // Wide enough to clear the RuntimeTranspilerCache minimum size (4KB).
  let big = "";
  for (let i = 0; i < 500; i++) big += `export function f${i}(x){return x+${i};}\n`;
  big += `export const COUNT = 500;\n`;

  using dir = tempDir("isolate-sync-provider", {
    "big.mjs": big,
    "a.test.ts": `
      import { test, expect } from "bun:test";
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";

      test("require(esm) provider carries module_info", () => {
        const path = require.resolve("./big.mjs");
        const m = require("./big.mjs");
        expect(m.COUNT).toBe(500);
        expect(m.f42(1)).toBe(43);
        expect(isolatedModuleCacheSourceType(path)).toBe("BunTranspiledModule");
      });
    `,
  });

  const cacheDir = `${String(dir)}/transpiler-cache`;
  for (const run of [1, 2]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.ts"],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr, `run ${run}`).toContain("1 pass");
    expect(stderr, `run ${run}`).toContain("0 fail");
    expect(exitCode, `run ${run}`).toBe(0);
  }
});

describe.concurrent("BUN_FEATURE_FLAG_EXPERIMENTAL_TEST_ISOLATE_REUSE_GLOBAL", () => {
  const reuseEnv = {
    ...bunEnv,
    BUN_FEATURE_FLAG_EXPERIMENTAL_TEST_ISOLATE_REUSE_GLOBAL: "1",
    BUN_DEBUG_test_isolate: "1",
    BUN_DEBUG_QUIET_LOGS: undefined,
  };
  const offEnv = {
    ...bunEnv,
    BUN_FEATURE_FLAG_EXPERIMENTAL_TEST_ISOLATE_REUSE_GLOBAL: undefined,
  };

  async function run(dir: string, args: string[], env: Record<string, string | undefined> = reuseEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function reuseSummary(stderr: string) {
    const m = stderr.match(
      /isolate reuse summary: (\d+) reused, (\d+) fresh \((\d+) fingerprint, (\d+) mock.module, (\d+) pending-fetch\)/,
    );
    if (!m) throw new Error("no reuse summary in stderr:\n" + stderr);
    return {
      reused: Number(m[1]),
      fresh: Number(m[2]),
      fingerprint: Number(m[3]),
      moduleMock: Number(m[4]),
      pendingFetch: Number(m[5]),
    };
  }

  // Defining semantic: a dependency's JSModuleRecord survives across files,
  // so its module-scope state is the same instance. Project-source modules are
  // evicted and re-evaluate fresh. With a fresh global per file (flag off)
  // the dep would ALSO be fresh, so file B would see `dep.touchedByA` unset.
  // --parallel=2 with a long scale-up delay makes worker 0 take both files
  // (run_as_coordinator short-circuits to serial at k<=1, so --parallel=1
  // would not exercise the worker loop).
  for (const [label, extra, extraEnv] of [
    ["", [], {}],
    [" (--parallel worker)", ["--parallel=2"], { BUN_TEST_PARALLEL_SCALE_MS: "60000" }],
  ] as const) {
    test(`node_modules records survive across files; project modules re-evaluate${label}`, async () => {
      using dir = tempDir("isolate-reuse-dep", {
        "node_modules/dep/package.json": `{"name":"dep","type":"module","main":"index.js"}`,
        "node_modules/dep/index.js": `
          export const state = { loads: 0 };
          state.loads++;
          export function hot(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }
        `,
        "project.ts": `
          export const state = { loads: 0 };
          state.loads++;
        `,
        "a.test.ts": `
          import { test, expect } from "bun:test";
          import { state as dep, hot } from "dep";
          import { state as proj } from "./project";
          test("a", () => {
            expect(dep.loads).toBe(1);
            expect(proj.loads).toBe(1);
            dep.touchedByA = true;
            proj.touchedByA = true;
            expect(hot(1000)).toBe(499500);
          });
        `,
        "b.test.ts": `
          import { test, expect } from "bun:test";
          import { state as dep, hot } from "dep";
          import { state as proj } from "./project";
          test("b", () => {
            expect(dep).toEqual({ loads: 1, touchedByA: true });
            expect(proj).toEqual({ loads: 1 });
            expect(hot(1000)).toBe(499500);
          });
        `,
      });
      const { stderr, exitCode } = await run(String(dir), ["--isolate", ...extra, "./a.test.ts", "./b.test.ts"], {
        ...reuseEnv,
        ...extraEnv,
      });
      expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      expect(exitCode).toBe(0);
    });
  }

  test("flag off: dep module is a fresh instance per file", async () => {
    using dir = tempDir("isolate-reuse-off", {
      "node_modules/dep/package.json": `{"name":"dep","type":"module","main":"index.js"}`,
      "node_modules/dep/index.js": `
        export const state = { loads: 0 };
        state.loads++;
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { state } from "dep";
        test("a", () => { state.touched = true; expect(state.loads).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { state } from "dep";
        test("b", () => {
          expect(state.loads).toBe(1);
          if (process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_TEST_ISOLATE_REUSE_GLOBAL === "1") {
            expect(state.touched).toBe(true);
          } else {
            expect(state.touched).toBeUndefined();
          }
        });
      `,
    });
    for (const env of [reuseEnv, offEnv]) {
      const { stderr, exitCode } = await run(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"], env);
      expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
      expect(exitCode).toBe(0);
    }
  });

  test("CJS: node_modules entry kept in require.cache; project entry evicted", async () => {
    using dir = tempDir("isolate-reuse-cjs", {
      "node_modules/cjsdep/package.json": `{"name":"cjsdep","main":"index.js"}`,
      "node_modules/cjsdep/index.js": `module.exports.state = { loads: 1 };`,
      "project.cjs": `module.exports.state = { loads: 1 };`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        const dep = require("cjsdep");
        const proj = require("./project.cjs");
        test("a", () => {
          dep.state.touchedByA = true;
          proj.state.touchedByA = true;
          expect(dep.state.loads).toBe(1);
          expect(proj.state.loads).toBe(1);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        const dep = require("cjsdep");
        const proj = require("./project.cjs");
        test("b", () => {
          expect(dep.state).toEqual({ loads: 1, touchedByA: true });
          expect(proj.state).toEqual({ loads: 1 });
        });
      `,
    });
    const { stderr, exitCode } = await run(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("leaked server, subprocess and timer are torn down on the reuse path", async () => {
    using dir = tempDir("isolate-reuse-cleanup", {
      "node_modules/state/package.json": `{"name":"state","type":"module","main":"index.js"}`,
      "node_modules/state/index.js": `export const s = {};`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { s } from "state";
        test("leak", async () => {
          const server = Bun.serve({ port: 0, fetch: () => new Response("hi") });
          s.port = server.port;
          s.ticks = 0;
          setInterval(() => { s.ticks++; }, 5).unref();
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{},1e6)"], stdio: ["ignore","ignore","ignore"] });
          s.pid = child.pid;
          expect(server.port).toBeGreaterThan(0);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { s } from "state";
        test("cleaned", async () => {
          expect(s.port).toBeGreaterThan(0);
          await expect(fetch("http://127.0.0.1:" + s.port)).rejects.toThrow(/Unable to connect|ECONNREFUSED|ConnectionRefused/);
          expect(() => process.kill(s.pid, 0)).toThrow(/ESRCH|No such process|kill/);
          const before = s.ticks;
          await Bun.sleep(30);
          expect(s.ticks).toBe(before);
        });
      `,
    });
    const { stderr, exitCode } = await run(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(reuseSummary(stderr)).toMatchObject({ reused: 1, fresh: 0 });
    expect(exitCode).toBe(0);
  });

  // Each pollution kind dirties the intrinsic fingerprint; the next file
  // boundary detects it and falls back to a fresh global, so file B sees a
  // clean world. The debug summary asserts exactly one fallback happened.
  const cleanCheck = `
    import { test, expect } from "bun:test";
    test("clean", () => {
      expect((globalThis as any).leaked).toBeUndefined();
      expect((Array.prototype as any).foo).toBeUndefined();
      expect(Math.random()).not.toBe(4);
      expect(typeof console.log).toBe("function");
      expect(process.listenerCount("exit")).toBe(0);
    });
  `;
  for (const [name, pollute] of [
    ["globalThis property", `(globalThis as any).leaked = 1;`],
    ["Array.prototype patch", `(Array.prototype as any).foo = () => 1;`],
    ["Math.random replacement", `Math.random = () => 4;`],
    ["console.log replacement", `console.log = () => {};`],
    ["process.on listener", `process.on("exit", () => {});`],
  ] as const) {
    test(`pollution (${name}) in file A is not visible in file B`, async () => {
      using dir = tempDir("isolate-reuse-fp", {
        "clean.test.ts": cleanCheck,
        "dirty.test.ts": `
          import { test, expect } from "bun:test";
          test("dirty", () => { ${pollute}; expect(1).toBe(1); });
        `,
        "observe.test.ts": cleanCheck,
      });
      const { stderr, exitCode } = await run(String(dir), [
        "--isolate",
        "./clean.test.ts",
        "./dirty.test.ts",
        "./observe.test.ts",
      ]);
      expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      expect(reuseSummary(stderr)).toMatchObject({ reused: 1, fresh: 1, fingerprint: 1 });
      expect(exitCode).toBe(0);
    });
  }

  test("a clean file pair reuses with no fallback", async () => {
    using dir = tempDir("isolate-reuse-clean", {
      "a.test.ts": cleanCheck,
      "b.test.ts": cleanCheck,
      "c.test.ts": cleanCheck,
    });
    const { stderr, exitCode } = await run(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
    expect(reuseSummary(stderr)).toMatchObject({ reused: 2, fresh: 0 });
    expect(exitCode).toBe(0);
  });

  test("mock.module in file A forces a fresh global; file B sees the real module", async () => {
    using dir = tempDir("isolate-reuse-mock", {
      "node_modules/dep/package.json": `{"name":"dep","type":"module","main":"index.js"}`,
      "node_modules/dep/index.js": `export const v = "real";`,
      "a.test.ts": `
        import { test, expect, mock } from "bun:test";
        mock.module("dep", () => ({ v: "fake" }));
        import { v } from "dep";
        test("a", () => { expect(v).toBe("fake"); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { v } from "dep";
        test("b", () => { expect(v).toBe("real"); });
      `,
    });
    const { stderr, exitCode } = await run(String(dir), ["--isolate", "./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(reuseSummary(stderr)).toMatchObject({ reused: 0, fresh: 1, moduleMock: 1 });
    expect(exitCode).toBe(0);
  });

  test("--preload runs once per global; runs again after a forced fallback", async () => {
    using dir = tempDir("isolate-reuse-preload", {
      "preload.ts": `
        (globalThis as any).__preload_count = ((globalThis as any).__preload_count ?? 0) + 1;
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("a", () => { expect((globalThis as any).__preload_count).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("b", () => { expect((globalThis as any).__preload_count).toBe(1); });
      `,
      "c-dirty.test.ts": `
        import { test, expect } from "bun:test";
        test("c", () => {
          expect((globalThis as any).__preload_count).toBe(1);
          (globalThis as any).pollute = 1;
        });
      `,
      "d.test.ts": `
        import { test, expect } from "bun:test";
        test("d", () => {
          // fresh global after c-dirty, preload re-ran exactly once
          expect((globalThis as any).__preload_count).toBe(1);
          expect((globalThis as any).pollute).toBeUndefined();
        });
      `,
    });
    const { stderr, exitCode } = await run(String(dir), [
      "--isolate",
      "--preload",
      "./preload.ts",
      "./a.test.ts",
      "./b.test.ts",
      "./c-dirty.test.ts",
      "./d.test.ts",
    ]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("4 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(reuseSummary(stderr)).toMatchObject({ reused: 2, fresh: 1, fingerprint: 1 });
    expect(exitCode).toBe(0);
  });

  test("--isolate=fresh-global disables reuse even with the flag set", async () => {
    using dir = tempDir("isolate-reuse-force-fresh", {
      "node_modules/dep/package.json": `{"name":"dep","type":"module","main":"index.js"}`,
      "node_modules/dep/index.js": `export const state = {};`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { state } from "dep";
        test("a", () => { state.touched = true; expect(1).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { state } from "dep";
        test("b", () => { expect(state.touched).toBeUndefined(); });
      `,
    });
    const { stderr, exitCode } = await run(String(dir), ["--isolate=fresh-global", "./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(stderr).not.toContain("isolate reuse summary");
    expect(exitCode).toBe(0);
  });

  test("--isolate rejects unknown values", async () => {
    using dir = tempDir("isolate-reuse-badval", { "a.test.ts": `test("a", () => {});` });
    const { stderr, exitCode } = await run(String(dir), ["--isolate=nope", "./a.test.ts"]);
    expect(stderr).toContain('expects no value or "fresh-global"');
    expect(exitCode).not.toBe(0);
  });
});
