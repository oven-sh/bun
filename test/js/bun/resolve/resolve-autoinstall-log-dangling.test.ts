import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When the runtime resolver's auto-install path lazily creates the
// PackageManager, it snapshots `resolver.log` into `pm.log`. If the
// PackageManager is created while the resolver log is pointed at a
// stack-local `Log` inside `resolveMaybeNeedsTrailingSlash`, `pm.log` must be
// restored to the VM log before returning, otherwise the next resolve at a
// different stack depth dereferences dead stack memory when the HTTP task
// fails and calls `manager.log_mut().add_error_fmt(...)`.
test("repeated failing auto-install resolves at varying stack depth don't read a dangling pm.log", async () => {
  // Run from an empty dir so the resolver falls through to the auto-install
  // path instead of stopping at the repo's own node_modules.
  using dir = tempDir("resolve-autoinstall-log", {});

  const src = `
    const realm = new ShadowRealm();
    const variants = [
      () => realm.importValue("pkg-not-found-a", "x"),
      () => (() => realm.importValue("pkg-not-found-b", "x"))(),
      () => (() => (() => realm.importValue("pkg-not-found-c", "x"))())(),
      () => { try { return realm.importValue("pkg-not-found-d", "x"); } finally {} },
      () => [realm.importValue("pkg-not-found-e", "x")][0],
      () => import("pkg-not-found-f"),
      () => (async () => realm.importValue("pkg-not-found-g", "x"))(),
    ];
    for (let i = 0; i < 100; i++) {
      for (const v of variants) {
        try {
          const p = v();
          if (p && p.catch) p.catch(() => {});
        } catch {}
      }
    }
    Bun.gc(true);
    console.log("ok");
  `;

  await using proc = Bun.spawn({
    // Force the auto-install path (PackageManager lazy init inside the
    // resolver) without hitting the network — the registry hostname is
    // unroutable, so every enqueued manifest fetch fails fast and routes
    // through `manager.log_mut()`.
    cmd: [bunExe(), "--install=fallback", "-e", src],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: "http://127.0.0.1:1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Auto-install's `sleep_until` used to tick the JS event loop while it waited
// for the manifest response. JS that ran during that tick (module transpile)
// swapped `PackageManager.log` (and the related resolver/linker/transpiler log
// pointers) and restored them from `transpiler.log`, which the outer resolve
// had not swapped, instead of the resolve's scoped log. The next `run_tasks`
// poll then wrote its 404 diagnostic into the VM's persistent log, which is
// dumped to stderr at process exit. With enough interleaving across REPRL
// iterations this escalated to `pm.log` pointing at dead stack memory (ASAN
// stack-buffer-overflow).
//
// The wait blocks the thread now, so the module loads queued before each
// resolve run after the loop and never inside a resolve.
test("module loads queued before a failing auto-install resolve run after it, and pm.log stays in sync", async () => {
  let hits = 0;
  await using server = Bun.serve({
    port: 0,
    fetch() {
      hits++;
      return new Response("Not Found", { status: 404 });
    },
  });

  using dir = tempDir("resolve-autoinstall-log-tick", {
    "index.js": `
      const Module = require("module");
      const fs = require("fs");
      const path = require("path");

      let n = 0;
      function load() {
        const f = path.join(import.meta.dir, "dyn" + n++ + ".cjs");
        fs.writeFileSync(f, "module.exports = 0;");
        try { require(f); } catch {}
      }

      for (let i = 0; i < 20; i++) {
        setImmediate(load);
        setImmediate(load);
        try {
          Module._resolveFilename("autoinstall-missing-pkg-" + i, { filename: import.meta.path });
        } catch {}
      }

      console.log("inside " + n);
      setImmediate(() => console.log("after " + n));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("inside 0\nafter 40\n");
  expect(hits).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
