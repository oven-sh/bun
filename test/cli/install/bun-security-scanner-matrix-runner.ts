import { bunEnv, bunExe, isWindows, runBunInstall, tempDirWithFiles } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isCI } from "../../harness";
import { getRegistry, SimpleRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

const CI_SAMPLE_PERCENT = 10; // only 10% of tests will run in CI because this matrix generates so many tests

const redSubprocessPrefix = "\x1b[31m [SUBPROC]\x1b[0m";
const redDebugPrefix = "\x1b[31m   [DEBUG]\x1b[0m";
const redShellPrefix = "\x1b[31m   [SHELL] $\x1b[0m";

function getTestName(testId: string, hasExistingNodeModules: boolean) {
  return `${testId} (${hasExistingNodeModules ? "with modules" : "without modules"})` as const;
}
type TestName = ReturnType<typeof getTestName>;

// prettier-ignore
// These tests are failing for other reasons outside of the security scanner.
// You should leave a comment above pointing to a GitHub issue for reference, so these
// don't get totally lost.
const TESTS_TO_SKIP: Set<string> = new Set<TestName>([
  // https://github.com/oven-sh/bun/issues/22255
  // remove "is-even"
  "0481 (without modules)", "0486 (without modules)", "0491 (without modules)", "0496 (without modules)", "0511 (without modules)", "0516 (without modules)", "0521 (without modules)", "0526 (without modules)",
  // remove "left-pad,is-even"
  "0541 (without modules)", "0546 (without modules)", "0551 (without modules)", "0556 (without modules)", "0571 (without modules)", "0576 (without modules)", "0581 (without modules)", "0586 (without modules)",
  // uninstall "is-even"
  "0601 (without modules)", "0606 (without modules)", "0611 (without modules)", "0616 (without modules)", "0631 (without modules)", "0636 (without modules)", "0641 (without modules)", "0646 (without modules)",
  // uninstall "left-pad,is-even"
  "0661 (without modules)", "0666 (without modules)", "0671 (without modules)", "0676 (without modules)", "0691 (without modules)", "0696 (without modules)", "0701 (without modules)", "0706 (without modules)",
]);

interface SecurityScannerTestOptions {
  command: "install" | "update" | "add" | "remove" | "uninstall";
  args: readonly string[];
  hasExistingNodeModules: boolean;
  linker: "hoisted" | "isolated";
  scannerType: "local" | "npm" | "npm.bunfigonly";
  scannerReturns: "none" | "warn" | "fatal";
  shouldFail: boolean;

  hasLockfile: boolean;
  scannerSyncronouslyThrows: boolean;

  // TTY options for testing interactive prompts
  hasTTY: boolean;
  ttyResponse: "y" | "n"; // Response to send when prompted (only used when hasTTY is true and scannerReturns is "warn")
}

const DO_TEST_DEBUG = process.env.SCANNER_TEST_DEBUG === "true";

async function globEverything(dir: string) {
  return await Array.fromAsync(
    new Bun.Glob("**/*").scan({ cwd: dir, dot: true, followSymlinks: false, onlyFiles: false }),
  );
}

let registryUrl: string;

async function runSecurityScannerTest(options: SecurityScannerTestOptions) {
  const registry = getRegistry();

  if (!registry) {
    throw new Error("Registry not found");
  }

  registry.clearRequestLog();
  registry.setScannerBehavior(options.scannerReturns ?? "none");

  const {
    command,
    args,
    hasExistingNodeModules,
    hasLockfile,
    linker,
    scannerType,
    scannerReturns,
    shouldFail,
    scannerSyncronouslyThrows,
    hasTTY,
    ttyResponse,
  } = options;

  const expectedExitCode = shouldFail ? 1 : 0;

  const scannerCode =
    scannerType === "local" || scannerType === "npm"
      ? `export const scanner = {
      version: "1",
      scan: async function(payload) {
        console.error("SCANNER_RAN: " + payload.packages.length + " packages");
        
        ${scannerSyncronouslyThrows ? "throw new Error('Scanner error!');" : ""}
        
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
    "package.json": JSON.stringify(
      {
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
                "test-security-scanner": "1.0.0",
              }
            : {}),
        },
      },
      null,
      "\t",
    ),
  };

  if (scannerType === "local") {
    files["scanner.js"] = scannerCode;
  }

  const dir = tempDirWithFiles("scanner-matrix", files);

  const scannerPath = scannerType === "local" ? "./scanner.js" : "test-security-scanner";

  // First write bunfig WITHOUT scanner for pre-install
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]
cache.disable = true
linker = "${linker}"
registry = "${registryUrl}/"`,
  );

  const shouldDoInitialInstall = hasExistingNodeModules || hasLockfile;
  if (hasExistingNodeModules || hasLockfile) {
    if (DO_TEST_DEBUG) console.log(redShellPrefix, `${bunExe()} install`);
    await runBunInstall(bunEnv, dir);
  }

  if (shouldDoInitialInstall && !hasExistingNodeModules) {
    if (DO_TEST_DEBUG) console.log(redShellPrefix, `rm -rf ${dir}/node_modules`);
    await rm(join(dir, "node_modules"), { recursive: true });
  }

  if (shouldDoInitialInstall && !hasLockfile) {
    if (DO_TEST_DEBUG) console.log(redShellPrefix, `rm ${dir}/bun.lock`);
    await rm(join(dir, "bun.lock"));
  }

  ////////////////////////// POST SETUP DONE //////////////////////////

  const cmd = [bunExe(), command, ...args];

  if (DO_TEST_DEBUG) {
    console.log(redDebugPrefix, "SETUP DONE");
    console.log("-------------------------------- THE REAL TEST IS ABOUT TO HAPPEN --------------------------------");
    console.log(redShellPrefix, cmd.join(" "));
  }

  registry.clearRequestLog();

  // write the full bunfig WITH scanner configuration
  await Bun.write(
    join(dir, "bunfig.toml"),
    `[install]
cache.disable = true
linker = "${linker}"
registry = "${registryUrl}/"

[install.security]
scanner = "${scannerPath}"`,
  );

  if (DO_TEST_DEBUG) {
    console.log(`[DEBUG] Test directory: ${dir}`);
    console.log(`[DEBUG] Command: ${cmd.join(" ")}`);
    console.log(`[DEBUG] Scanner type: ${scannerType}`);
    console.log(`[DEBUG] Scanner returns: ${scannerReturns}`);
    console.log(`[DEBUG] Has existing node_modules: ${hasExistingNodeModules}`);
    console.log(`[DEBUG] Linker: ${linker}`);
    console.log("");
    console.log("Files in test directory:");
    const files = await globEverything(dir);
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
  }

  let errAndOut = "";
  let exitCode: number;

  if (hasTTY) {
    let responseSent = false;

    await using terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, data) {
        const text = new TextDecoder().decode(data);
        errAndOut += text;

        if (DO_TEST_DEBUG) {
          const lines = text.split("\n");
          for (const line of lines) {
            process.stdout.write(redSubprocessPrefix);
            process.stdout.write(" ");
            process.stdout.write(line);
            process.stdout.write("\n");
          }
        }

        // When we see the prompt, send the configured response
        if (!responseSent && errAndOut.includes("Continue anyway? [y/N]")) {
          responseSent = true;
          terminal.write(ttyResponse + "\n");
        }
      },
    });

    await using proc = Bun.spawn(cmd, {
      cwd: dir,
      env: bunEnv,
      terminal,
    });

    exitCode = await proc.exited;
  } else {
    // Non-TTY mode: use piped stdin to ensure isatty(stdin) returns false
    await using proc = Bun.spawn({
      cmd,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: bunEnv,
    });

    if (DO_TEST_DEBUG) {
      const write = (chunk: Uint8Array<ArrayBuffer>, stream: NodeJS.WriteStream, decoder: TextDecoder) => {
        const str = decoder.decode(chunk, { stream: true });

        errAndOut += str;

        const lines = str.split("\n");
        for (const line of lines) {
          stream.write(redSubprocessPrefix);
          stream.write(" ");
          stream.write(line);
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
    } else {
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
      errAndOut = stdout + stderr;
    }

    exitCode = await proc.exited;
  }

  if (exitCode !== expectedExitCode) {
    console.log("Command:", cmd.join(" "));
    console.log("Expected exit code:", expectedExitCode, "Got:", exitCode);
    console.log("Test directory:", dir);
    console.log("Files in test dir:", await globEverything(dir));
    console.log("Registry:", registryUrl);
    console.log();
    console.log("bunfig:");
    console.log(await Bun.file(join(dir, "bunfig.toml")).text());
    console.log();
  }

  expect(exitCode).toBe(expectedExitCode);

  // If the scanner is from npm and there are no node modules when the test "starts"
  // then we should expect Bun to do the partial install first of all
  if (scannerType === "npm" && !hasExistingNodeModules) {
    expect(errAndOut).toContain("Attempting to install security scanner from npm");
    expect(errAndOut).toContain("Security scanner installed successfully");
  }

  if (scannerType === "npm.bunfigonly") {
    expect(errAndOut).toContain("");
  }

  if (scannerType !== "npm.bunfigonly" && !scannerSyncronouslyThrows) {
    expect(errAndOut).toContain("SCANNER_RAN");

    if (scannerReturns === "warn") {
      expect(errAndOut).toContain("WARNING:");
      expect(errAndOut).toContain("Test warning");

      if (hasTTY) {
        // In TTY mode, we should see the interactive prompt
        expect(errAndOut).toContain("Continue anyway? [y/N]");
        if (ttyResponse === "y") {
          expect(errAndOut).toContain("Continuing with installation...");
        } else {
          expect(errAndOut).toContain("Installation cancelled.");
        }
      } else {
        // In non-TTY mode, we should see the no-TTY error message
        expect(errAndOut).toContain("Security warnings found. Cannot prompt for confirmation (no TTY).");
        expect(errAndOut).toContain("Installation cancelled.");
      }
    } else if (scannerReturns === "fatal") {
      expect(errAndOut).toContain("FATAL:");
      expect(errAndOut).toContain("Test fatal error");
    }
  }

  if (scannerType !== "npm.bunfigonly" && !hasExistingNodeModules) {
    switch (scannerReturns) {
      case "fatal": {
        // Fatal advisories always cancel installation
        expect(await Bun.file(join(dir, "node_modules", "left-pad", "package.json")).exists()).toBe(false);
        break;
      }

      case "warn": {
        if (hasTTY && ttyResponse === "y") {
          // User accepted the warning in TTY mode, command proceeds normally
          // For remove/uninstall without existing node_modules, nothing gets installed
          // For other commands, packages should be installed
          if (command === "remove" || command === "uninstall") {
            // These commands don't install packages, they remove them
            // Without existing node_modules, there's nothing to verify
          } else {
            expect(await Bun.file(join(dir, "node_modules", "left-pad", "package.json")).exists()).toBe(true);
          }
        } else {
          // No TTY to prompt OR user rejected, installation is cancelled
          expect(await Bun.file(join(dir, "node_modules", "left-pad", "package.json")).exists()).toBe(false);
        }
        break;
      }

      case "none": {
        // When there are no security issues, packages should be installed normally

        switch (command) {
          case "remove":
          case "uninstall": {
            for (const arg of args) {
              switch (linker) {
                case "hoisted": {
                  expect(await Bun.file(join(dir, "node_modules", arg, "package.json")).exists()).toBe(false);
                  break;
                }

                case "isolated": {
                  const versionInRegistry = SimpleRegistry.packages[arg][0];
                  const path = join(
                    dir,
                    "node_modules",
                    ".bun",
                    `${arg}@${versionInRegistry}`,
                    "node_modules",
                    arg,
                    "package.json",
                  );
                  expect(await Bun.file(path).exists()).toBe(false);
                  break;
                }
              }
            }
            break;
          }

          default: {
            for (const arg of args) {
              switch (linker) {
                case "hoisted": {
                  expect(await Bun.file(join(dir, "node_modules", arg, "package.json")).exists()).toBe(true);
                  break;
                }

                case "isolated": {
                  const versionInRegistry = SimpleRegistry.packages[arg][0];
                  const path = join(
                    dir,
                    "node_modules",
                    ".bun",
                    `${arg}@${versionInRegistry}`,
                    "node_modules",
                    arg,
                    "package.json",
                  );
                  expect(await Bun.file(path).exists()).toBe(true);
                  break;
                }
              }
            }
            break;
          }
        }

        break;
      }
    }
  }

  const requestedPackages = registry.getRequestedPackages();
  const requestedTarballs = registry.getRequestedTarballs();

  // when we have no node modules and the scanner comes from npm, we must first install the scanner
  // but, if we expect the scanner to report failure then we should ONLY see the scanner tarball requested, no others
  // Exception: when hasTTY is true and ttyResponse is "y", the user accepts the warning and installation continues
  const installationWasCancelled =
    scannerReturns === "fatal" || (scannerReturns === "warn" && (!hasTTY || ttyResponse === "n"));

  if (scannerType === "npm" && !hasExistingNodeModules && installationWasCancelled) {
    const doWeExpectToAlwaysTryToResolve =
      // If there is no lockfile, we will resolve packages
      !hasLockfile ||
      // Unless we are updating
      (command === "update" && args.length === 0) ||
      // Unless there are arguments, but it's chill because one of the arguments is the security
      // scanner, so we would expect to be resolving
      args.includes("test-security-scanner");

    if (doWeExpectToAlwaysTryToResolve) {
      expect(requestedPackages).toContain("test-security-scanner");
    } else {
      expect(requestedPackages).not.toContain("test-security-scanner");
    }

    // we should have ONLY requested the security scanner at this point
    expect(requestedTarballs).toEqual(["/test-security-scanner-1.0.0.tgz"]);
  }

  const sortedPackages = [...requestedPackages].sort();
  const sortedTarballs = [...requestedTarballs].sort();

  const key = `${command} ${args.length > 0 ? "with args" : "without args"}` as const;
  expect(sortedPackages).toMatchSnapshot(`requested-packages: ${key}`);
  expect(sortedTarballs).toMatchSnapshot(`requested-tarballs: ${key}`);
}

export function runSecurityScannerTests(selfModuleName: string, hasExistingNodeModules: boolean) {
  let i = 0;

  const { describe, beforeAll, afterAll, test } = Bun.jest(selfModuleName);

  beforeAll(async () => {
    registryUrl = await startRegistry(DO_TEST_DEBUG);
  });

  afterAll(() => {
    stopRegistry();
  });

  const ttyConfigs = [
    { hasTTY: false, ttyResponse: "n", ttyLabel: "no-TTY" } as const,
    { hasTTY: true, ttyResponse: "y", ttyLabel: "TTY:y" } as const,
    { hasTTY: true, ttyResponse: "n", ttyLabel: "TTY:n" } as const,
  ];
  const ttyConfigsNoTTY = ttyConfigs.filter(c => !c.hasTTY);

  describe.each(["install", "update", "add", "remove", "uninstall"] as const)("bun %s", command => {
    describe.each([
      { args: [], name: "no args" },
      { args: ["is-even"], name: "is-even" },
      { args: ["left-pad", "is-even"], name: "left-pad,is-even" },
    ])("$name", ({ args }) => {
      describe.each(["hoisted", "isolated"] as const)("--linker=%s", linker => {
        describe.each(["local", "npm", "npm.bunfigonly"] as const)("(scanner: %s)", scannerType => {
          describe.each([true, false] as const)("(bun.lock exists: %p)", hasLockfile => {
            describe.each(["none", "warn", "fatal"] as const)("(advisories: %s)", scannerReturns => {
              // TTY tests only apply to "warn" cases - for "none" and "fatal", only test non-TTY
              const applicableTtyConfigs = scannerReturns === "warn" ? ttyConfigs : ttyConfigsNoTTY;

              describe.each(applicableTtyConfigs)("($ttyLabel)", ({ hasTTY, ttyResponse }) => {
                if ((command === "add" || command === "uninstall" || command === "remove") && args.length === 0) {
                  // TODO(@alii): Test this case:
                  //  - Exit code 1
                  //  - No changes to disk
                  //  - Scanner does not run
                  return;
                }

                const testName = getTestName(String(++i).padStart(4, "0"), hasExistingNodeModules);

                if (TESTS_TO_SKIP.has(testName)) {
                  return test.skip(testName, async () => {
                    // TODO
                  });
                }

                if (hasTTY && isWindows) {
                  return test.skip(testName, async () => {
                    // PTY not supported on Windows
                  });
                }

                if (isCI) {
                  if (command === "uninstall") {
                    return test.skip(testName, async () => {
                      // Same as `remove`, optimising for CI time here
                    });
                  }

                  const random = Math.random();

                  if (random < (100 - CI_SAMPLE_PERCENT) / 100) {
                    return test.skip(testName, async () => {
                      // skipping this one for CI
                    });
                  }
                }

                // npm.bunfigonly is the case where a scanner is a valid npm package name identifier
                // but is not referenced in package.json anywhere and is not in the lockfile, so the only knowledge
                // of this package's existence is the fact that it was defined in as the value in bunfig.toml
                // Therefore, we should fail because we don't know where to install it from
                const shouldFail =
                  scannerType === "npm.bunfigonly" ||
                  scannerReturns === "fatal" ||
                  (scannerReturns === "warn" && (!hasTTY || ttyResponse === "n"));

                test(testName, async () => {
                  await runSecurityScannerTest({
                    command,
                    args,
                    hasExistingNodeModules,
                    linker,
                    scannerType,
                    scannerReturns,
                    shouldFail,
                    hasLockfile,

                    // TODO(@alii): Test this case
                    scannerSyncronouslyThrows: false,

                    hasTTY,
                    ttyResponse,
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}
