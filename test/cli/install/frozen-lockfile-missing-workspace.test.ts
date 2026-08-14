import { file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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

const notFound = 'Workspace not found "packages/api"';

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function bun(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "--linker", "hoisted"],
    cwd: dir,
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// bun.lock ends up describing `onDisk`; package.json lists `listed`; `remove` folders and node_modules are gone.
async function tree(onDisk: Record<string, object>, listed: string[], remove: string[] = []) {
  const { packageDir: dir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" } });
  await Promise.all([
    write(join(dir, "package.json"), JSON.stringify({ name: "mono", workspaces: Object.keys(onDisk) })),
    ...Object.entries(onDisk).map(([path, pkg]) => write(join(dir, path, "package.json"), JSON.stringify(pkg))),
  ]);

  const { stderr, exitCode } = await bun(dir, ["install"]);
  expect(stderr).toContain("Saved lockfile");
  expect(exitCode).toBe(0);
  const lock = await file(join(dir, "bun.lock")).text();

  await Promise.all([
    write(join(dir, "package.json"), JSON.stringify({ name: "mono", workspaces: listed })),
    rm(join(dir, "node_modules"), { recursive: true }),
    ...remove.map(path => rm(join(dir, path), { recursive: true })),
  ]);
  return { dir, lock };
}

async function expectRejected(dir: string, lock: string, args: string[]) {
  const { stderr, exitCode } = await bun(dir, args);
  expect(stderr).toContain(notFound);
  expect(stderr).not.toContain("lockfile had changes");
  expect(await file(join(dir, "bun.lock")).text()).toBe(lock);
  expect(await exists(join(dir, "node_modules"))).toBeFalse();
  expect(exitCode).toBe(1);
  return { stderr };
}

const notFoundLine = (stderr: string) => stderr.split("\n").find(line => line.includes("Workspace not found"));

describe("a listed workspace that is on neither disk nor in bun.lock", () => {
  test.concurrent("--frozen-lockfile rejects it like a plain install", async () => {
    const { dir, lock } = await tree({ "packages/app": app }, ["packages/app", "packages/api"]);

    const plain = await bun(dir, ["install"]);
    expect(plain.stderr).toContain(notFound);
    expect(plain.exitCode).toBe(1);
    expect(await exists(join(dir, "node_modules"))).toBeFalse();

    const { stderr } = await expectRejected(dir, lock, ["install", "--frozen-lockfile"]);

    expect(notFoundLine(stderr)).toBeDefined();
    expect(notFoundLine(stderr)).toBe(notFoundLine(plain.stderr));
  });

  test.concurrent("--production rejects it too", async () => {
    const { dir, lock } = await tree({ "packages/app": app }, ["packages/app", "packages/api"]);

    await expectRejected(dir, lock, ["install", "--production"]);
  });

  test.concurrent("bun ci rejects it too", async () => {
    const { dir, lock } = await tree({ "packages/app": app }, ["packages/app", "packages/api"]);

    await expectRejected(dir, lock, ["ci"]);
  });

  test.concurrent(
    "a workspace pruned from disk but still in bun.lock is tolerated while an unknown one next to it is still rejected",
    async () => {
      const { dir, lock } = await tree(
        { "packages/app": app, "packages/shared": shared },
        ["packages/app", "packages/shared", "packages/api"],
        ["packages/shared"],
      );
      expect(lock).toContain('"packages/shared"');
      expect(lock).not.toContain('"packages/api"');

      const { stderr } = await expectRejected(dir, lock, ["install", "--frozen-lockfile"]);

      expect(stderr).not.toContain('Workspace not found "packages/shared"');
    },
  );
});
