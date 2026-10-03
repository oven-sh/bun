import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// mkdir on a dangling symlink reports EEXIST, mkdir below it reports ENOENT.
// The recursive mkdir behind the install cache directory used to retry that
// pair forever, so `bun install` sat at 100% CPU before resolving anything.
// The folder dependency keeps the install off the network.
test("install completes when BUN_INSTALL_CACHE_DIR is under a dangling symlink", async () => {
  using dir = tempDir("install-cache-dir-dangling", {
    "proj/package.json": JSON.stringify({
      name: "x",
      version: "1.0.0",
      dependencies: { localdep: "file:./localdep" },
    }),
    "proj/localdep/package.json": JSON.stringify({ name: "localdep", version: "1.2.3" }),
  });
  symlinkSync(join(String(dir), "does-not-exist"), join(String(dir), "dangling"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: join(String(dir), "proj"),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "dangling", "cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const root = String(dir);
  expect({
    stdout,
    stderr,
    installed: existsSync(join(root, "proj", "node_modules", "localdep", "package.json")),
    // The install falls back to the cache directory inside node_modules.
    fallbackCache: existsSync(join(root, "proj", "node_modules", ".cache")),
    // Nothing is created through the link.
    linkTarget: existsSync(join(root, "does-not-exist")),
  }).toEqual({
    stdout: expect.stringContaining("1 package installed"),
    stderr: expect.any(String),
    installed: true,
    fallbackCache: true,
    linkTarget: false,
  });
  expect(exitCode).toBe(0);
});
