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

  if (!registry) {
    throw new Error("Registry not found");
  }

  registry.clearRequestLog();
  registry.setScannerBehavior(options.scannerReturns ?? "clean");

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
      ? `export const scanner = {
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

        // For npm scanner, add it to dependencies so it gets installed
        ...(scannerType === "npm"
          ? {
              [scannerPackageName]: "1.0.0",
            }
          : {}),
        ...additionalDependencies,
      },
    }),
  };

  if (scannerType === "local") {
    files["scanner.js"] = scannerCode;
  }

  const dir = tempDirWithFiles("scanner-matrix", files);

  const scannerPath = scannerType === "local" ? "./scanner.js" : scannerPackageName;

  if (hasExistingNodeModules) {
    // First write bunfig WITHOUT scanner for pre-install
    await Bun.write(
      join(dir, "bunfig.toml"),
      `[install]
cache = false
linker = "${linker}"
registry = "${registryUrl}/"`,
    );

    // Install initial node_modules without scanner configured
    await $`${bunExe()} install`.cwd(dir).env(bunEnv).quiet();
  }

  // write the full bunfig WITH scanner configuration
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]
cache = false
linker = "${linker}"
registry = "${registryUrl}/"

[install.security]
scanner = "${scannerPath}"`,
  );

  // Prepare the command
  let cmd = [bunExe(), command];
  if (args.length > 0) {
    cmd = [...cmd, ...args];
  }

  // Debug mode: if SCANNER_TEST_DEBUG env var is set, print the test dir and exit
  if (process.env.SCANNER_TEST_DEBUG) {
    console.log(`[DEBUG] Test directory: ${dir}`);
    console.log(`[DEBUG] Command: ${cmd.join(" ")}`);
    console.log(`[DEBUG] Scanner type: ${scannerType}`);
    console.log(`[DEBUG] Scanner returns: ${scannerReturns}`);
    console.log(`[DEBUG] Has existing node_modules: ${hasExistingNodeModules}`);
    console.log(`[DEBUG] Linker: ${linker}`);
    console.log("");
    console.log("Files in test directory:");
    const files = await Array.fromAsync(new Bun.Glob("**/*").scan(dir));
    for (const file of files) {
      console.log(`  ${file}`);
    }
    console.log("");
    console.log("bunfig.toml contents:");
    console.log(await Bun.file(join(dir, "bunfig.toml")).text());
    console.log("");
    console.log("package.json contents:");
    console.log(await Bun.file(join(dir, "package.json")).text());
    console.log("");
    console.log("To run the command manually:");
    console.log(`cd ${dir} && ${cmd.join(" ")}`);
    console.log("");
    console.log("Registry URL:", registryUrl);
    console.log("Registry should be running on this port (check with: lsof -i :PORT)");
    console.log("");
    console.log("Keeping test alive... Press Ctrl+C to exit");

    await new Promise(r => {});
  }

  const proc = Bun.spawn({
    cmd,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: bunEnv,
  });

  let errAndOut = "";

  const write = (chunk: Uint8Array<ArrayBuffer>, stream: NodeJS.WriteStream, decoder: TextDecoder) => {
    const str = decoder.decode(chunk).trim();

    errAndOut += str;

    const redSubprocessPrefix = "\x1b[31m [SUBPROC] \x1b[0m";

    if (str.length > 0) {
      stream.write(redSubprocessPrefix);
      stream.write(str);
      stream.write("\n");
    }
  };

  const outDecoder = new TextDecoder();
  const stdoutWriter = new WritableStream<Uint8Array<ArrayBuffer>>({
    write: chunk => write(chunk, process.stdout, outDecoder),
    close: () => void process.stdout.write(outDecoder.decode()),
  });

  const errDecoder = new TextDecoder();
  const stderrWriter = new WritableStream<Uint8Array<ArrayBuffer>>({
    write: chunk => write(chunk, process.stderr, errDecoder),
    close: () => void process.stderr.write(errDecoder.decode()),
  });

  await Promise.all([proc.stdout.pipeTo(stdoutWriter), proc.stderr.pipeTo(stderrWriter)]);

  const exitCode = await proc.exited;

  if (exitCode !== expectedExitCode) {
    console.log("Command:", cmd.join(" "));
    console.log("Expected exit code:", expectedExitCode, "Got:", exitCode);
    console.log("Test directory:", dir);
    console.log(
      "Files in test dir:",
      await Array.fromAsync(
        new Bun.Glob("**/*").scan({ cwd: dir, dot: true, followSymlinks: false, onlyFiles: false }),
      ),
    );
    console.log("Registry:", registryUrl);
    console.log();
    console.log("bunfig:");
    console.log(await Bun.file(join(dir, "bunfig.toml")).text());
    console.log();
  }

  expect(exitCode).toBe(expectedExitCode);

  for (const expected of expectedOutput) {
    expect(errAndOut).toContain(expected);
  }

  for (const unexpected of unexpectedOutput) {
    expect(errAndOut).not.toContain(unexpected);
  }

  if (expectedError) {
    expect(errAndOut).toContain(expectedError);
  }

  // If the scanner is from npm and there are no node modules when the test "starts"
  // then we should expect Bun to do the partial install first of all
  if (scannerType === "npm" && !hasExistingNodeModules) {
    console.log("[TEST DEBUG] Checking for partial install messages");
    expect(errAndOut).toContain("Attempting to install security scanner from npm");
    expect(errAndOut).toContain("Security scanner installed successfully");
  }

  if (scannerType === "bunfig-only") {
    expect(errAndOut).toContain("");
  }

  if (scannerType !== "bunfig-only" && !scannerError) {
    expect(errAndOut).toContain("SCANNER_RAN");

    if (scannerReturns === "warn") {
      expect(errAndOut).toContain("WARNING:");
      expect(errAndOut).toContain("Test warning");
    } else if (scannerReturns === "fatal") {
      expect(errAndOut).toContain("FATAL:");
      expect(errAndOut).toContain("Test fatal error");
    }
  }

  if (scannerType !== "bunfig-only" && !hasExistingNodeModules) {
    switch (scannerReturns) {
      case "fatal":
      case "warn": {
        // When there are fatal advisories OR warnings (with no TTY to prompt),
        // the installation is cancelled and packages should NOT be installed
        const files = await Array.fromAsync(
          new Bun.Glob("**/*").scan({ cwd: dir, dot: true, followSymlinks: false, onlyFiles: false }),
        );
        expect(files).not.toContain("node_modules/left-pad/package.json");
        break;
      }

      case "clean": {
        // When there are no security issues, packages should be installed normally
        const files = await Array.fromAsync(
          new Bun.Glob("**/*").scan({ cwd: dir, dot: true, followSymlinks: true, onlyFiles: false }),
        );
        expect(files).toContain("node_modules/left-pad/package.json");
        break;
      }
    }
  }

  // Verify node_modules was created for successful installs
  // if (command === "install" && expectedExitCode === 0) {
  //   const nodeModulesExists = await Bun.file(join(dir, "node_modules")).exists();
  //   expect(nodeModulesExists).toBe(true);
  // }

  // // Verify packages were actually installed/removed
  // if ((command === "add" || command === "install") && expectedExitCode === 0) {
  //   const leftPadExists = await Bun.file(join(dir, "node_modules", "left-pad", "package.json")).exists();
  //   expect(leftPadExists).toBe(true);

  //   if (command === "add" && args.includes("is-even")) {
  //     const isEvenExists = await Bun.file(join(dir, "node_modules", "is-even", "package.json")).exists();
  //     expect(isEvenExists).toBe(true);
  //   }
  // }

  // if ((command === "remove" || command === "uninstall") && expectedExitCode === 0) {
  //   if (args.includes("is-even")) {
  //     const isEvenExists = await Bun.file(join(dir, "node_modules", "is-even", "package.json")).exists();
  //     expect(isEvenExists).toBe(false);
  //   }

  //   const leftPadExists = await Bun.file(join(dir, "node_modules", "left-pad", "package.json")).exists();
  //   expect(leftPadExists).toBe(true);
  // }

  // if (expectedExitCode === 0 && command !== "update" && command !== "install") {
  //   const lockfileExists = await Bun.file(join(dir, "bun.lock")).exists();
  //   expect(lockfileExists).toBe(true);
  // }

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

  return { errAndOut, exitCode, dir };
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
    describe.each([
      { args: [], name: "no args" },
      { args: ["is-even"], name: "is-even" },
      { args: ["left-pad", "is-even"], name: "left-pad,is-even" },
    ])("$name", ({ args }) => {
      describe.each(["true", "false"] as const)("(node_modules: %s)", _hasNodeModules => {
        const hasExistingNodeModules = _hasNodeModules === "true";

        describe.each(["hoisted", "isolated"] as const)("--linker=%s", linker => {
          describe.each(["local", "npm", "bunfig-only"] as const)("(scanner: %s)", scannerType => {
            describe.each(["clean", "warn", "fatal"] as const)("(returns: %s)", scannerReturns => {
              if ((command === "add" || command === "uninstall" || command === "remove") && args.length === 0) {
                return;
              }

              const testName = String(++i).padStart(4, "0");

              const shouldFail =
                scannerType === "bunfig-only" || scannerReturns === "fatal" || scannerReturns === "warn";
              const expectedOutput: string[] = [];
              const expectedError = scannerType === "bunfig-only" ? "Security scanner" : undefined;

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
