import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { getRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

interface SecurityScannerTestOptions {
  command: "install" | "update" | "add" | "remove" | "uninstall";
  args?: string[];
  hasExistingNodeModules?: boolean;
  linker?: "hoisted" | "isolated";
  scannerType: "local" | "npm" | "bunfig-only";
  scannerPackageName?: string;
  scannerReturns?: "clean" | "warn" | "fatal";
  scannerError?: boolean;
  shouldFail?: boolean;
  expectedExitCode?: number;
  expectedOutput?: string[];
  unexpectedOutput?: string[];
  expectedError?: string;

  additionalDependencies?: Record<string, string>;
}

let registryUrl: string;

async function runSecurityScannerTest(options: SecurityScannerTestOptions) {
  // Clear registry request log before test
  const registry = getRegistry();
  if (registry) {
    registry.clearRequestLog();
  }

  const {
    command,
    args = [],
    hasExistingNodeModules = false,
    linker = "hoisted",
    scannerType,
    scannerPackageName = "test-security-scanner",
    scannerReturns = "clean",
    scannerError = false,
    shouldFail = false,
    expectedExitCode = shouldFail ? 1 : 0,
    expectedOutput = [],
    unexpectedOutput = [],
    expectedError,
    additionalDependencies = {},
  } = options;

  // Create scanner code based on configuration
  const scannerCode =
    scannerType === "local" || scannerType === "npm"
      ? `"export const scanner = {
      version: "1",
      scan: async function(payload) {
        console.error("SCANNER_RAN: " + payload.packages.length + " packages");
        
        ${scannerError ? "throw new Error('Scanner error!');" : ""}
        
        const results = [];
        ${
          scannerReturns === "warn"
            ? `
        if (payload.packages.length > 0) {
          results.push({
            package: payload.packages[0].name,
            level: "warn",
            description: "Test warning"
          });
        }`
            : ""
        }
        ${
          scannerReturns === "fatal"
            ? `
        if (payload.packages.length > 0) {
          results.push({
            package: payload.packages[0].name,
            level: "fatal",
            description: "Test fatal error"
          });
        }`
            : ""
        }
        return results;
      }
    }`
      : `throw new Error("Should not have been loaded")`;

  // Base files for the test directory
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {
        "left-pad": "1.3.0",
        // For remove/uninstall commands, add the packages we're trying to remove
        ...(command === "remove" || command === "uninstall"
          ? {
              "is-even": "1.0.0",
              "is-odd": "1.0.0",
            }
          : {}),
        ...additionalDependencies,
      },
    }),
  };

  // Add scanner based on type
  if (scannerType === "local") {
    files["scanner.js"] = scannerCode;
  } else if (scannerType === "npm" || scannerType === "bunfig-only") {
    // For npm scanner, create a local package that simulates an npm package
    // We'll use the file: protocol to reference it
    files["scanner-npm-package/package.json"] = JSON.stringify({
      name: scannerPackageName,
      version: "1.0.0",
      main: "index.js",
    });
    files["scanner-npm-package/index.js"] = scannerCode;
    // TODO: add npm scanner tests

    // Add to dependencies if not bunfig-only
    if (scannerType === "npm") {
      const pkg = JSON.parse(files["package.json"]);
      pkg.dependencies[scannerPackageName] = "file:./scanner-npm-package";
      files["package.json"] = JSON.stringify(pkg);
    }
  }

  // Create the test directory
  const dir = tempDirWithFiles("scanner-matrix", files);

  // Special handling for npm scanner - install it first without security config
  let skipMainCommand = false;
  if (scannerType === "npm") {
    // First install without scanner to get the npm package installed
    await $`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();

    // If this is an install command with npm scanner, we'll run it again with the scanner
    // But for now, let's mark that we already installed
    if (command === "install") {
      skipMainCommand = false; // We still want to run install again with scanner
    }
  } else if (hasExistingNodeModules && command !== "install") {
    // For update/add commands, do initial install without scanner
    await $`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();
  }

  // Now add bunfig with scanner configuration
  const scannerPath = scannerType === "local" ? "./scanner.js" : scannerPackageName;

  await Bun.write(
    join(dir, "bunfig.toml"),
    `
[install]
cache = false
linker = "${linker}"
registry = "${registryUrl}/"

[install.security]
scanner = "${scannerPath}"
`,
  );

  // Prepare the command
  let cmd = [bunExe(), command];
  if (args.length > 0) {
    cmd = [...cmd, ...args];
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  if (!skipMainCommand) {
    // Run the command
    const proc = Bun.spawn({
      cmd,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  }

  // Debug output for failures
  if (exitCode !== expectedExitCode) {
    console.log("Command:", cmd.join(" "));
    console.log("Expected exit code:", expectedExitCode, "Got:", exitCode);
    console.log("Test directory:", dir);
    console.log("Files in test dir:", await Array.fromAsync(new Bun.Glob("**/*").scan(dir)));
    console.log("Stdout:", stdout);
    console.log("Stderr:", stderr);
  }

  // Verify expectations
  expect(exitCode).toBe(expectedExitCode);

  // Check expected output
  for (const expected of expectedOutput) {
    expect(stdout + stderr).toContain(expected);
  }

  // Check unexpected output
  for (const unexpected of unexpectedOutput) {
    expect(stdout + stderr).not.toContain(unexpected);
  }

  // Check for specific error
  if (expectedError) {
    expect(stderr).toContain(expectedError);
  }

  if (registry) {
    const requestedPackages = registry.getRequestedPackages();
    const requestedTarballs = registry.getRequestedTarballs();

    if (command === "install") {
      expect(requestedPackages).toMatchSnapshot("requested-packages: install");
      expect(requestedTarballs).toMatchSnapshot("requested-tarballs: install");
    } else if (command === "add") {
      expect(requestedPackages).toMatchSnapshot("requested-packages: add");
      expect(requestedTarballs).toMatchSnapshot("requested-tarballs: add");
    } else if (command === "update") {
      if (args.length > 0) {
        expect(requestedPackages).toMatchSnapshot("requested-packages: update with args");
        expect(requestedTarballs).toMatchSnapshot("requested-tarballs: update with args");
      } else {
        expect(requestedPackages).toMatchSnapshot("requested-packages: update without args");
        expect(requestedTarballs).toMatchSnapshot("requested-tarballs: update without args");
      }
    } else {
      expect(requestedPackages).toMatchSnapshot("requested-packages: unknown command");
      expect(requestedTarballs).toMatchSnapshot("requested-tarballs: unknown command");
    }
  }

  return { stdout, stderr, exitCode, dir };
}

beforeAll(async () => {
  registryUrl = await startRegistry();
});

afterAll(() => {
  stopRegistry();
});

describe("Security Scanner Matrix Tests", () => {
  let i = 0;

  describe.each(["install", "update", "add", "remove", "uninstall"] as const)("bun %s", command => {
    const argConfigs: Array<{ args: string[]; name: string }> =
      command === "install"
        ? [{ args: [], name: "no args" }]
        : command === "update"
          ? [
              { args: [], name: "no args" },
              { args: ["left-pad"], name: "left-pad" },
            ]
          : [
              { args: ["is-even"], name: "is-even" },
              { args: ["left-pad", "is-even"], name: "left-pad,is-even" },
            ];

    describe.each(argConfigs)("$name", ({ args }) => {
      describe.each(["true", "false"] as const)("(node_modules: %s)", _hasNodeModules => {
        const hasExistingNodeModules = _hasNodeModules === "true";

        describe.each(["hoisted", "isolated"] as const)("--linker=%s", linker => {
          describe.each(["local", "npm", "bunfig-only"] as const)("(scanner: %s)", scannerType => {
            describe.each(["clean", "warn", "fatal"] as const)("(returns: %s)", scannerReturns => {
              if (command === "install" && hasExistingNodeModules) {
                return;
              }

              const testName = String(++i);

              if (command === "install" && args.length > 0) {
                test.todo(testName, async () => {});
                return;
              }

              if (scannerType === "npm") {
                test.todo(testName, async () => {});
                return;
              }

              // For remove/uninstall commands, only bunfig-only should fail
              // Warnings and fatal advisories are printed but don't block removal
              const shouldFail =
                scannerType === "bunfig-only" ||
                (command !== "remove" &&
                  command !== "uninstall" &&
                  (scannerReturns === "warn" || scannerReturns === "fatal"));
              const expectedOutput = scannerType === "bunfig-only" ? [] : ["SCANNER_RAN"];
              const expectedError = scannerType === "bunfig-only" ? "Security scanner" : undefined;

              if (scannerType !== "bunfig-only") {
                if (scannerReturns === "warn") {
                  expectedOutput.push("WARNING:");
                }
                if (scannerReturns === "fatal") {
                  expectedOutput.push("FATAL:");
                }
              }

              test(testName, async () => {
                await runSecurityScannerTest({
                  command,
                  args,
                  hasExistingNodeModules,
                  linker,
                  scannerType,
                  scannerReturns,
                  expectedOutput,
                  shouldFail,
                  expectedError,
                });
              });
            });
          });
        });
      });
    });
  });
});
