// https://github.com/oven-sh/bun/issues/28062
// Windows: two `bun install` processes sharing BUN_INSTALL_CACHE_DIR race to
// publish the same cache entry. The loser must accept the winner's entry and
// never delete it; otherwise the winner's install fails with ENOENT opening
// the cache dir it just published.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let verdaccio: VerdaccioRegistry | undefined;

beforeAll(async () => {
  if (!isWindows) return;
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
}, 60_000);

afterAll(() => {
  verdaccio?.stop();
});

// The destructive rename-out-and-delete lived in the #[cfg(windows)] publish
// path; POSIX uses an atomic RENAME_EXCHANGE and never had the ENOENT window.
test.skipIf(!isWindows)(
  "concurrent installs sharing a cache dir do not delete each other's cache entries",
  async () => {
    const dependencies = {
      "no-deps": "1.0.0",
      "a-dep": "1.0.1",
      "basic-1": "1.0.0",
      "what-bin": "1.0.0",
      "one-dep": "1.0.0",
      "two-range-deps": "1.0.0",
      "dep-with-tags": "1.0.0",
      "dep-loop-entry": "1.0.0",
    };
    const pkg = JSON.stringify({ name: "cache-race", private: true, dependencies });

    using root = tempDir("bun-install-cache-race", {});
    const cache = join(String(root), "shared-cache");
    const bunfig = `[install]\nregistry = "${verdaccio!.registryUrl()}"\n`;

    const projects: string[] = [];
    for (let i = 0; i < 4; i++) {
      const dir = join(String(root), `p${i}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "package.json"), pkg);
      await writeFile(join(dir, "bunfig.toml"), bunfig);
      projects.push(dir);
    }

    const env = {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cache,
    };

    const install = async (cwd: string) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { cwd, stdout, stderr, exitCode };
    };

    // Before the fix, the loser's rename-out + delete of the winner's cache
    // entry created a guaranteed ENOENT window (>=10ms of backoff) every time
    // two processes collided on the same package, so a handful of rounds with
    // a fresh cache is enough to hit it reliably.
    for (let round = 0; round < 8; round++) {
      await rm(cache, { recursive: true, force: true });
      for (const dir of projects) {
        await rm(join(dir, "node_modules"), { recursive: true, force: true });
        await rm(join(dir, "bun.lock"), { force: true });
      }

      const results = await Promise.all(projects.map(install));
      const failed = results.filter(r => r.exitCode !== 0);
      if (failed.length) {
        const detail = failed.map(r => `cwd=${r.cwd}\nstderr:\n${r.stderr}\nstdout:\n${r.stdout}`).join("\n---\n");
        expect(detail).toBe("");
      }
      for (const r of results) {
        expect(r.stderr).not.toContain("ENOENT");
        expect(r.exitCode).toBe(0);
      }
    }
  },
  120_000,
);
