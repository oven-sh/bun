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
          await Bun.sleep(100);
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
});
