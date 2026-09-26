import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  dummyRegistryForContext,
  package_dir,
  requested,
  root_url,
  setContextHandler,
  setHandler,
  type TestContext,
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

describe("--lockfile-only and lockfile migration under --frozen-lockfile, --dry-run, and --no-save", () => {
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
  const yarnLock = ["# yarn lockfile v1", "", "", '"foo@file:./foo":', '  version "1.0.0"', ""].join("\n");
  const migrations: [string, string][] = [
    ["package-lock.json", npmLock],
    ["pnpm-lock.yaml", pnpmLock],
    ["yarn.lock", yarnLock],
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

  it.concurrent.each(["--frozen-lockfile", "--production", "--dry-run", "--no-save"])(
    "%s --lockfile-only leaves an up-to-date bun.lock byte-identical",
    async flag => {
      using tmp = tempDir("lockfile-only-frozen", project);
      const dir = String(tmp);
      const setup = await run(dir, "--lockfile-only");
      expect(setup.stderr).not.toContain("error:");
      expect(setup.exitCode).toBe(0);
      const canary = readFileSync(lock(dir), "utf8") + "\n";
      writeFileSync(lock(dir), canary);

      const { stdout, stderr, exitCode } = await run(dir, flag, "--lockfile-only");
      expect(stdout + stderr).not.toContain("Saved");
      expect(readFileSync(lock(dir), "utf8")).toBe(canary);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(["--frozen-lockfile", "--production", "--dry-run", "--no-save"])(
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
    const setup = await run(dir, "--lockfile-only");
    expect(setup.stderr).not.toContain("error:");
    expect(setup.exitCode).toBe(0);
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

  const frozenNote = (name: string) =>
    `note: the lockfile is frozen, so the migration from ${name} was not written to bun.lock; run 'bun install' and commit the result`;

  it.concurrent.each(migrations)(
    "--frozen-lockfile --lockfile-only migrates %s in memory and does not write bun.lock",
    async (name, contents) => {
      using tmp = tempDir("lockfile-only-frozen-migrate", { ...project, [name]: contents });
      const dir = String(tmp);

      const { stdout, stderr, exitCode } = await run(dir, "--frozen-lockfile", "--lockfile-only");
      expect(stderr).toContain(`migrated lockfile from ${name}`);
      expect(stderr).toContain(frozenNote(name));
      expect(stdout + stderr).not.toContain("Saved");
      expect(existsSync(lock(dir))).toBe(false);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(migrations)(
    "--frozen-lockfile installs from a migrated %s and does not write bun.lock",
    async (name, contents) => {
      using tmp = tempDir("frozen-migrate", { ...project, [name]: contents });
      const dir = String(tmp);

      const { stdout, stderr, exitCode } = await run(dir, "--frozen-lockfile");
      expect(stderr).toContain(`migrated lockfile from ${name}`);
      expect(stderr).toContain(frozenNote(name));
      expect(stdout + stderr).not.toContain("Saved");
      expect(existsSync(lock(dir))).toBe(false);
      expect(existsSync(join(dir, "node_modules", "foo", "package.json"))).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(migrations)("--dry-run does not write bun.lock when migrating from %s", async (name, contents) => {
    using tmp = tempDir("dry-run-migrate", { ...project, [name]: contents });
    const dir = String(tmp);

    const { stdout, stderr, exitCode } = await run(dir, "--dry-run");
    expect(stderr).toContain(`migrated lockfile from ${name}`);
    expect(stderr).not.toContain("note:");
    expect(stdout + stderr).not.toContain("Saved");
    expect(existsSync(lock(dir))).toBe(false);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  it.concurrent.each(migrations)(
    "--no-save installs from a migrated %s and does not write bun.lock",
    async (name, contents) => {
      using tmp = tempDir("no-save-migrate", { ...project, [name]: contents });
      const dir = String(tmp);

      const { stdout, stderr, exitCode } = await run(dir, "--no-save");
      expect(stderr).toContain(`migrated lockfile from ${name}`);
      expect(stderr).not.toContain("note:");
      expect(stdout + stderr).not.toContain("Saved");
      expect(existsSync(lock(dir))).toBe(false);
      expect(existsSync(join(dir, "node_modules", "foo", "package.json"))).toBe(true);
      expect(exitCode).toBe(0);
    },
  );

  it.concurrent.each(migrations)(
    "a plain install still writes bun.lock when migrating from %s",
    async (name, contents) => {
      using tmp = tempDir("install-migrate", { ...project, [name]: contents });
      const dir = String(tmp);

      const { stderr, exitCode } = await run(dir);
      expect(stderr).toContain(`migrated lockfile from ${name}`);
      expect(stderr).toContain("Saved lockfile");
      expect(readFileSync(lock(dir), "utf8")).toContain('"foo": ["foo@file:foo", {}]');
      expect(existsSync(join(dir, "node_modules", "foo", "package.json"))).toBe(true);
      expect(exitCode).toBe(0);
    },
  );
});

describe("--lockfile-only with remove and update", () => {
  async function setup(deps: Record<string, string>, versions: Record<string, unknown>) {
    const ctx = await createTestContext();
    const dir = ctx.package_dir;
    await writeFile(
      join(dir, "bunfig.toml"),
      Bun.TOML.stringify({ install: { registry: ctx.registry_url, saveTextLockfile: true } }),
    );
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: deps }));
    const urls: string[] = [];
    setContextHandler(ctx, dummyRegistryForContext(ctx, urls, versions));
    const setupRun = await run(ctx, "install", "--lockfile-only");
    expect(setupRun.stderr).not.toContain("error:");
    expect(setupRun.exitCode).toBe(0);
    urls.length = 0;
    return { ctx, dir, urls };
  }

  async function run(ctx: TestContext, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd: ctx.package_dir,
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(ctx.package_dir, ".bun-cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it.concurrent(
    "bun remove --lockfile-only edits package.json and bun.lock without creating node_modules",
    async () => {
      const { ctx, dir, urls } = await setup({ bar: "0.0.1", baz: "0.0.1" }, { "0.0.1": {} });
      try {
        const before = readFileSync(join(dir, "bun.lock"), "utf8");
        expect(before).toContain('"bar": ["bar@0.0.1"');
        expect(before).toContain('"baz": ["baz@0.0.1"');

        const { stdout, stderr, exitCode } = await run(ctx, "remove", "--lockfile-only", "bar");
        expect(stderr).not.toContain("error:");
        expect(stderr).toContain("Saved lockfile");
        expect(stdout).toContain("Saved bun.lock");
        expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toStrictEqual({
          name: "foo",
          dependencies: { baz: "0.0.1" },
        });
        const after = readFileSync(join(dir, "bun.lock"), "utf8");
        expect(after).not.toContain("bar@");
        expect(after).toContain('"baz": ["baz@0.0.1"');
        expect(urls.filter(url => url.endsWith(".tgz"))).toStrictEqual([]);
        expect(existsSync(join(dir, "node_modules"))).toBe(false);
        expect(exitCode).toBe(0);
      } finally {
        destroyTestContext(ctx);
      }
    },
  );

  it.concurrent(
    "bun update --lockfile-only edits package.json and bun.lock without creating node_modules",
    async () => {
      const { ctx, dir, urls } = await setup({ baz: "~0.0.3" }, { "0.0.3": {}, latest: "0.0.3" });
      try {
        expect(readFileSync(join(dir, "bun.lock"), "utf8")).toContain('"baz": ["baz@0.0.3"');
        setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

        const { stdout, stderr, exitCode } = await run(ctx, "update", "--lockfile-only", "baz");
        expect(stderr).not.toContain("error:");
        expect(stderr).toContain("Saved lockfile");
        expect(stdout).toContain("Saved bun.lock");
        expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toStrictEqual({
          name: "foo",
          dependencies: { baz: "~0.0.5" },
        });
        const after = readFileSync(join(dir, "bun.lock"), "utf8");
        expect(after).toContain('"baz": ["baz@0.0.5"');
        expect(after).not.toContain("baz@0.0.3");
        expect(urls.map(url => url.slice(ctx.registry_url.length))).toStrictEqual(["baz"]);
        expect(existsSync(join(dir, "node_modules"))).toBe(false);
        expect(exitCode).toBe(0);
      } finally {
        destroyTestContext(ctx);
      }
    },
  );

  it.concurrent("bun update --lockfile-only with no arguments re-resolves the whole lockfile", async () => {
    const { ctx, dir, urls } = await setup({ baz: "~0.0.3" }, { "0.0.3": {}, latest: "0.0.3" });
    try {
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" }));

      const { stdout, stderr, exitCode } = await run(ctx, "update", "--lockfile-only");
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("Saved bun.lock");
      expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toStrictEqual({
        name: "foo",
        dependencies: { baz: "~0.0.5" },
      });
      const after = readFileSync(join(dir, "bun.lock"), "utf8");
      expect(after).toContain('"baz": ["baz@0.0.5"');
      expect(after).not.toContain("baz@0.0.3");
      expect(urls.map(url => url.slice(ctx.registry_url.length))).toStrictEqual(["baz"]);
      expect(existsSync(join(dir, "node_modules"))).toBe(false);
      expect(exitCode).toBe(0);
    } finally {
      destroyTestContext(ctx);
    }
  });
});
