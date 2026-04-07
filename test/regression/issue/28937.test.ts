// https://github.com/oven-sh/bun/issues/28937
//
// `bun link --dev <package>` should add the package to devDependencies.
// Before the fix, `--dev` (and `--optional`/`--peer`) were silently dropped
// by the CLI parser for the `link` subcommand, and nothing was written to
// package.json.
import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function setupLink(group: "dev" | "optional" | "peer" | "save" | "no-save") {
  // Isolate the "global" dir bun link uses so we don't touch the host.
  const globalRoot = tempDir(`issue-28937-global-${group}`, {});
  const installEnv = {
    ...bunEnv,
    BUN_INSTALL: String(globalRoot),
    BUN_INSTALL_GLOBAL_DIR: join(String(globalRoot), "install", "global"),
    BUN_INSTALL_BIN: join(String(globalRoot), "bin"),
  };

  const linkable = tempDir(`issue-28937-target-${group}`, {
    "package.json": JSON.stringify({
      name: "issue-28937-linked-pkg",
      version: "1.0.0",
    }),
  });

  // Register the linkable package globally.
  await using registerProc = Bun.spawn({
    cmd: [bunExe(), "link"],
    cwd: String(linkable),
    env: installEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [registerStdout, registerStderr, registerExit] = await Promise.all([
    registerProc.stdout.text(),
    registerProc.stderr.text(),
    registerProc.exited,
  ]);
  // Debug builds print an ASAN warning on stderr; assert only that no error
  // was logged, not that stderr is completely empty.
  expect(registerStderr).not.toContain("error:");
  expect(registerStdout).toContain(`Registered "issue-28937-linked-pkg"`);
  expect(registerExit).toBe(0);

  const consumer = tempDir(`issue-28937-consumer-${group}`, {
    "package.json": JSON.stringify({
      name: "issue-28937-consumer",
      version: "1.0.0",
    }),
  });

  return { globalRoot, linkable, consumer, installEnv };
}

describe("bun link dependency group flags (issue #28937)", () => {
  test("--dev writes to devDependencies", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("dev");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "--dev", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("installed issue-28937-linked-pkg@link:issue-28937-linked-pkg");

    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg).toEqual({
      name: "issue-28937-consumer",
      version: "1.0.0",
      devDependencies: {
        "issue-28937-linked-pkg": "link:issue-28937-linked-pkg",
      },
    });
    expect(exitCode).toBe(0);
  });

  test("-d (short form) writes to devDependencies", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("dev");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "-d", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");

    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg.devDependencies).toEqual({
      "issue-28937-linked-pkg": "link:issue-28937-linked-pkg",
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("--optional writes to optionalDependencies", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("optional");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "--optional", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");

    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg.optionalDependencies).toEqual({
      "issue-28937-linked-pkg": "link:issue-28937-linked-pkg",
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("--peer writes to peerDependencies", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("peer");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "--peer", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");

    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg.peerDependencies).toEqual({
      "issue-28937-linked-pkg": "link:issue-28937-linked-pkg",
    });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("--save still writes to dependencies (unchanged)", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("save");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "--save", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");

    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg.dependencies).toEqual({
      "issue-28937-linked-pkg": "link:issue-28937-linked-pkg",
    });
    expect(pkg.devDependencies).toBeUndefined();
    expect(exitCode).toBe(0);
  });

  test("explicit --no-save overrides the implied --save from --dev", async () => {
    const { consumer, installEnv, globalRoot, linkable } = await setupLink("no-save");
    using _g = globalRoot;
    using _l = linkable;
    using _c = consumer;

    const originalPkg = await file(join(String(consumer), "package.json")).json();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "link", "--dev", "--no-save", "issue-28937-linked-pkg"],
      cwd: String(consumer),
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");

    // package.json must not have been mutated despite --dev implying save.
    const pkg = await file(join(String(consumer), "package.json")).json();
    expect(pkg).toEqual(originalPkg);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies).toBeUndefined();
    expect(exitCode).toBe(0);
  });
});
