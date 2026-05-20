import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When the runtime resolver's auto-install path lazily creates the
// PackageManager, it snapshots `resolver.log` into `pm.log`. If the
// PackageManager is created while the resolver log is pointed at a
// stack-local `Log` inside `resolveMaybeNeedsTrailingSlash`, `pm.log` must be
// restored to the VM log before returning, otherwise the next resolve at a
// different stack depth dereferences dead stack memory when the HTTP task
// fails and calls `manager.log.add_error_fmt(...)`.
//
// The Zig original already swaps and restores `linker.log` and
// `package_manager.log`; this test guards against regression.
test("repeated failing auto-install resolves at varying stack depth don't read a dangling pm.log", async () => {
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
