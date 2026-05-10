import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When auto-install is enabled, the resolver must not attempt to install a
// package whose name is not a valid npm package name. Attempting to do so
// reentrantly ticks the JS event loop from inside the resolver, which has led
// to crashes when reached via mock.module() / vi.mock() / Bun.resolveSync()
// with arbitrary user-provided strings.
test("resolver does not attempt auto-install for invalid npm package names", async () => {
  let requests = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("resolve-autoinstall-invalid-name", {
    "index.js": `
      const specifiers = [
        "function f2() {\\n    const v6 = new ArrayBuffer();\\n}",
        "has spaces",
        "(parens)",
        "{braces}",
        "line1\\nline2",
        "foo\\tbar",
        "a\\u0000b",
      ];
      for (const s of specifiers) {
        try {
          Bun.resolveSync(s, import.meta.dir);
        } catch {}
      }
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(requests).toBe(0);
  expect(exitCode).toBe(0);
});

// Auto-install's `sleepUntil` pumps the full JS event loop while the resolver
// is on the stack holding slices that borrow from the referrer's
// WTF::StringImpl. If pending JS (timers/GC) runs during that window, those
// borrowed bytes must not be invalidated before the resolver reads them again
// to build the ResolveMessage.
test("resolver survives event-loop re-entrancy during auto-install", async () => {
  let requests = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("resolve-autoinstall-reentrant", {
    "index.js": `
      let uncaught = 0;
      process.on("uncaughtException", () => { uncaught++; });
      let caught = 0;
      for (let i = 0; i < 10; i++) {
        setImmediate(() => { Bun.gc(true); throw new Error("from-immediate"); });
        try {
          require("pkg-does-not-exist-" + i);
        } catch (e) {
          if (typeof e.referrer !== "string" || !e.referrer.endsWith("index.js"))
            throw new Error("bad referrer: " + e.referrer);
          caught++;
        }
      }
      setImmediate(() => console.log("caught=" + caught + " uncaught=" + uncaught));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("caught=10 uncaught=10");
  expect(requests).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});

test("resolver still attempts auto-install for valid npm package names", async () => {
  let requests = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      requests++;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });

  using dir = tempDir("resolve-autoinstall-valid-name", {
    "index.js": `
      try {
        Bun.resolveSync("some-package-that-does-not-exist-abc123", import.meta.dir);
      } catch {}
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(requests).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
