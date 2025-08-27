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
beforeEach(dummyBeforeEach);
afterEach(dummyAfterEach);

test("security scanner runs on bun update with warning", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  // Create a security scanner that returns a warning
  const scannerCode = `
    export const scanner = {
      version: "1",
      scan: async ({ packages }) => {
        if (packages.length === 0) return [];
        return [
          {
            package: "bar",
            description: "Test warning for bun update",
            level: "warn",
            url: "https://example.com/advisory",
          },
        ];
      },
    };
  `;

  await write("./scanner.ts", scannerCode);
  await write("./bunfig.toml", `[install.security]\nscanner = "./scanner.ts"`);

  // Create initial package.json with a dependency
  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      bar: "^0.0.1",
    },
  });

  // First install the dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install", "--no-summary"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await installProc.stdout.text();
  await installProc.stderr.text();
  const installExitCode = await installProc.exited;

  // Now there's a newer version available (0.0.3), let's run update
  // For warnings, we need to confirm with "y"
  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update", "bar"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  // Write "y\n" to confirm security warning
  updateProc.stdin.write("y\n");
  updateProc.stdin.end();

  const [updateOut, updateErr, updateExitCode] = await Promise.all([
    updateProc.stdout.text(),
    updateProc.stderr.text(),
    updateProc.exited,
  ]);

  // Check for security warning
  expect(updateOut).toContain("WARN: bar");
  expect(updateOut).toContain("Test warning for bun update");
  expect(updateOut).toContain("Security warnings found");

  // Should succeed after confirmation
  expect(updateExitCode).toBe(0);
});

test("security scanner blocks bun update on fatal advisory", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  const scannerCode = `
    export const scanner = {
      version: "1",
      scan: async ({ packages }) => {
        if (packages.length === 0) return [];
        return [
          {
            package: "bar",
            description: "Fatal security issue detected",
            level: "fatal",
            url: "https://example.com/critical",
          },
        ];
      },
    };
  `;

  await write("./scanner.ts", scannerCode);
  await write("./bunfig.toml", `[install.security]\nscanner = "./scanner.ts"`);
  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      bar: "^0.0.1",
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

  await using updateProc = Bun.spawn({
    cmd: [bunExe(), "update", "bar"],
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

  expect(updateOut).toContain("FATAL: bar");
  expect(updateOut).toContain("Fatal security issue detected");
  expect(updateOut).toContain("Installation aborted due to fatal security advisories");

  expect(updateExitCode).toBe(1);
});

test("security scanner does not run on bun update when disabled", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));

  await write("package.json", {
    name: "my-app",
    version: "1.0.0",
    dependencies: {
      bar: "^0.0.1",
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
    cmd: [bunExe(), "update", "bar"],
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
