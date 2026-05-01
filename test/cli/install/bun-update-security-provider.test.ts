import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  setHandler,
  write,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

test("security scanner blocks bun update on fatal advisory", async () => {
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.1.0": {},
      "0.2.0": {},
    }),
  );

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

  await write("./scanner.ts", scannerCode);
  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      moo: "0.1.0",
    },
  });

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
    "./bunfig.toml",
    `
[install]
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
  const urls: string[] = [];
  setHandler(
    dummyRegistry(urls, {
      "0.1.0": {},
      "0.2.0": {},
    }),
  );

  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      moo: "0.1.0",
    },
  });

  // Remove bunfig.toml to ensure no security scanner
  await write("bunfig.toml", "");

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
