import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { exists, rm } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const app = { name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } };
const shared = { name: "shared", version: "1.0.0" };

async function bun(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "--linker", "hoisted"],
    cwd: dir,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent(
  "--frozen-lockfile tolerates a workspace pruned from disk but still rejects an unknown one listed next to it",
  async () => {
    const { packageDir: dir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({ name: "mono", workspaces: ["packages/app", "packages/shared"] }),
      ),
      write(join(dir, "packages", "app", "package.json"), JSON.stringify(app)),
      write(join(dir, "packages", "shared", "package.json"), JSON.stringify(shared)),
    ]);

    const full = await bun(dir, ["install"]);
    expect(full.stderr).toContain("Saved lockfile");
    expect(full.exitCode).toBe(0);
    const lock = await file(join(dir, "bun.lock")).text();
    expect(lock).toContain('"packages/shared"');
    expect(lock).not.toContain('"packages/api"');

    await Promise.all([
      write(
        join(dir, "package.json"),
        JSON.stringify({ name: "mono", workspaces: ["packages/app", "packages/shared", "packages/api"] }),
      ),
      rm(join(dir, "node_modules"), { recursive: true }),
      rm(join(dir, "packages", "shared"), { recursive: true }),
    ]);

    const { stderr, exitCode } = await bun(dir, ["install", "--frozen-lockfile"]);

    expect(stderr).toContain('Workspace not found "packages/api"');
    expect(stderr).not.toContain('Workspace not found "packages/shared"');
    expect(stderr).not.toContain("lockfile had changes");
    expect(await file(join(dir, "bun.lock")).text()).toBe(lock);
    expect(await exists(join(dir, "node_modules"))).toBeFalse();
    expect(exitCode).toBe(1);
  },
);
