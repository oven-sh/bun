import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

it.each(["bun.lockb", "bun.lock"])("should not download tarballs with --lockfile-only using %s", async lockfile => {
  const isLockb = lockfile === "bun.lockb";

  const urls: string[] = [];
  const registry = { "0.0.1": { as: "0.0.1" }, latest: "0.0.1" };

  setHandler(dummyRegistry(urls, registry));

  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        baz: "0.0.1",
      },
    }),
  );

  const cmd = [bunExe(), "install", "--lockfile-only"];

  if (!isLockb) {
    // the default beforeEach disables --save-text-lockfile in the dummy registry, so we should restore
    // default behaviour
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
        },
      }),
    );
  }

  const { stdout, stderr, exited } = spawn({
    cmd,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  expect(await exited).toBe(0);
  const err = await stderr.text();

  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");

  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun install v1."),
    "",
    expect.stringContaining(`Saved ${lockfile}`),
  ]);

  expect(urls.sort()).toEqual([`${root_url}/baz`]);
  expect(requested).toBe(1);

  await access(join(package_dir, lockfile));
});

describe("--lockfile-only under --frozen-lockfile", () => {
  const project = {
    "foo/package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    "package.json": JSON.stringify({ name: "mig", dependencies: { foo: "file:./foo" } }),
  };
  const npmLock = JSON.stringify({
    name: "mig",
    lockfileVersion: 3,
    packages: {
      "": { name: "mig", dependencies: { foo: "file:./foo" } },
      foo: { name: "foo", version: "1.0.0" },
      "node_modules/foo": { resolved: "foo", link: true },
    },
  });
  const pnpmLock = [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .:",
    "    dependencies:",
    "      foo:",
    "        specifier: file:./foo",
    "        version: file:foo",
    "packages:",
    "  foo@file:foo:",
    "    resolution: {directory: foo, type: directory}",
    "snapshots:",
    "  foo@file:foo: {}",
    "",
  ].join("\n");
  const migrations: [string, string][] = [
    ["package-lock.json", npmLock],
    ["pnpm-lock.yaml", pnpmLock],
  ];

  async function run(dir: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: dir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const lock = (dir: string) => join(dir, "bun.lock");

  it.concurrent.each(["--frozen-lockfile", "--production"])(
    "%s --lockfile-only leaves an up-to-date bun.lock byte-identical",
    async flag => {
      using tmp = tempDir("lockfile-only-frozen", project);
      const dir = String(tmp);
      expect((await run(dir, "--lockfile-only")).exitCode).toBe(0);
      const canary = readFileSync(lock(dir), "utf8") + "\n";
      writeFileSync(lock(dir), canary);

      const { stdout, stderr, exitCode } = await run(dir, flag, "--lockfile-only");
      expect(stdout + stderr).not.toContain("Saved");
      expect(readFileSync(lock(dir), "utf8")).toBe(canary);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(["--frozen-lockfile", "--production"])(
    "%s --lockfile-only does not create a missing bun.lock",
    async flag => {
      using tmp = tempDir("lockfile-only-frozen-missing", project);
      const dir = String(tmp);

      const { stdout, stderr, exitCode } = await run(dir, flag, "--lockfile-only");
      expect(stdout + stderr).not.toContain("Saved");
      expect(existsSync(lock(dir))).toBe(false);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent("--lockfile-only rewrites an up-to-date bun.lock", async () => {
    using tmp = tempDir("lockfile-only-rewrite", project);
    const dir = String(tmp);
    expect((await run(dir, "--lockfile-only")).exitCode).toBe(0);
    const original = readFileSync(lock(dir), "utf8");
    writeFileSync(lock(dir), original + "\n");

    const { stdout, exitCode } = await run(dir, "--lockfile-only");
    expect(stdout).toContain("Saved bun.lock (2 packages)");
    expect(readFileSync(lock(dir), "utf8")).toBe(original);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  it.concurrent.each(migrations)("--lockfile-only migrates %s", async (name, contents) => {
    using tmp = tempDir("lockfile-only-migrate", { ...project, [name]: contents });
    const dir = String(tmp);

    const { stdout, stderr, exitCode } = await run(dir, "--lockfile-only");
    expect(stderr).toContain(`migrated lockfile from ${name}`);
    expect(stdout).toContain("Saved bun.lock (2 packages)");
    expect(readFileSync(lock(dir), "utf8")).toContain('"foo": ["foo@file:foo", {}]');
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  it.concurrent.each(migrations)(
    "--frozen-lockfile --lockfile-only still writes bun.lock when migrating from %s",
    async (name, contents) => {
      using tmp = tempDir("lockfile-only-frozen-migrate", { ...project, [name]: contents });
      const dir = String(tmp);

      const { stdout, stderr, exitCode } = await run(dir, "--frozen-lockfile", "--lockfile-only");
      expect(stderr).toContain(`migrated lockfile from ${name}`);
      expect(stdout).toContain("Saved bun.lock (2 packages)");
      expect(readFileSync(lock(dir), "utf8")).toContain('"foo": ["foo@file:foo", {}]');
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(migrations)("--frozen-lockfile writes bun.lock when migrating from %s", async (name, contents) => {
    using tmp = tempDir("frozen-migrate", { ...project, [name]: contents });
    const dir = String(tmp);

    const { stderr, exitCode } = await run(dir, "--frozen-lockfile");
    expect(stderr).toContain(`migrated lockfile from ${name}`);
    expect(existsSync(lock(dir))).toBe(true);
    expect(readFileSync(lock(dir), "utf8")).toContain('"foo": ["foo@file:foo", {}]');
    expect(existsSync(join(dir, "node_modules", "foo", "package.json"))).toBe(true);
    expect(exitCode).toBe(0);
  });
});
