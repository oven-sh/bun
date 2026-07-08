import { write } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { NpmRegistry, bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

let registry: NpmRegistry;
let package_dir: string;

beforeEach(async () => {
  registry = await new NpmRegistry().start();
  registry.define("moo", { "0.1.0": {}, "0.2.0": {} });
  package_dir = tmpdirSync();
  await write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${registry.url}"
saveTextLockfile = false
`,
  );
});

afterEach(() => {
  registry.stop();
});

test("security scanner blocks bun update on fatal advisory", async () => {
  const scannerCode = `
    export const scanner = {
      version: "1",
      scan: async ({ packages }) => {
        if (packages.length === 0) return [];
        return [
          {
            package: "moo",
            description: "Fatal security issue detected",
            level: "fatal",
            url: "https://example.com/critical",
          },
        ];
      },
    };
  `;

  await write(join(package_dir, "scanner.ts"), scannerCode);
  await write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        moo: "0.1.0",
      },
    }),
  );

  // First install without security scanning (to have something to update)
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-summary"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await installProc.stdout.text();
  await installProc.stderr.text();
  await installProc.exited;

  await write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${registry.url}"
saveTextLockfile = false

[install.security]
scanner = "./scanner.ts"
`,
  );

  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update", "moo"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [updateOut, updateErr, updateExitCode] = await Promise.all([
    updateProc.stdout.text(),
    updateProc.stderr.text(),
    updateProc.exited,
  ]);

  expect(updateOut).toContain("FATAL: moo");
  expect(updateOut).toContain("Fatal security issue detected");
  expect(updateOut).toContain("Installation aborted due to fatal security advisories");

  expect(updateExitCode).toBe(1);
});

test("security scanner does not run on bun update when disabled", async () => {
  await write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "my-app",
      version: "1.0.0",
      dependencies: {
        moo: "0.1.0",
      },
    }),
  );

  // No [install.security] section: the scanner must not run.
  await write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "${registry.url}"
saveTextLockfile = false
`,
  );

  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-summary"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await installProc.stdout.text();
  await installProc.stderr.text();
  await installProc.exited;

  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update", "moo"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [updateOut, updateErr, updateExitCode] = await Promise.all([
    updateProc.stdout.text(),
    updateProc.stderr.text(),
    updateProc.exited,
  ]);

  expect(updateOut).not.toContain("Security scanner");
  expect(updateOut).not.toContain("WARN:");
  expect(updateOut).not.toContain("FATAL:");

  expect(updateExitCode).toBe(0);
});
