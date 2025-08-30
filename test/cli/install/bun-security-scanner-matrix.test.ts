import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";
import { getRegistry, SimpleRegistry, startRegistry, stopRegistry } from "./simple-dummy-registry";

const redSubprocessPrefix = "\x1b[31m [SUBPROC]\x1b[0m";
const redDebugPrefix = "\x1b[31m   [DEBUG]\x1b[0m";
const redShellPrefix = "\x1b[31m   [SHELL] $\x1b[0m";

// prettier-ignore
// These tests are failing for other reasons outside of the security scanner.
// You should leave a comment above pointing to a GitHub issue for reference, so these
// don't get totally lost.
const TESTS_TO_SKIP: Set<string> = new Set<`${number}`>([
  // https://github.com/oven-sh/bun/issues/22255
  "0613", "0616", "0619", "0622", "0631", "0634", "0637", "0640",  // remove "is-even"
  "0685", "0688", "0691", "0694", "0703", "0706", "0709", "0712",  // remove "left-pad,is-even"
  "0757", "0760", "0763", "0766", "0775", "0778", "0781", "0784",  // uninstall "is-even"
  "0829", "0832", "0835", "0838", "0847", "0850", "0853", "0856",  // uninstall "left-pad,is-even"
]);

interface SecurityScannerTestOptions {
  command: "install" | "update" | "add" | "remove" | "uninstall";
  args: string[];
  hasExistingNodeModules: boolean;
  linker: "hoisted" | "isolated";
  scannerType: "local" | "npm" | "npm.bunfigonly";
  scannerReturns: "none" | "warn" | "fatal";
  shouldFail: boolean;

  hasLockfile: boolean;
  scannerSyncronouslyThrows: boolean;
}

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
    console.log(redShellPrefix, `${bunExe()} install`);
    await $`${bunExe()} install`.cwd(dir).env(bunEnv);
  }

  if (shouldDoInitialInstall && !hasExistingNodeModules) {
    console.log(redShellPrefix, `rm -rf ${dir}/node_modules`);
    await $`rm -rf node_modules`.cwd(dir);
  }

  if (shouldDoInitialInstall && !hasLockfile) {
    console.log(redShellPrefix, `rm ${dir}/bun.lock`);
    await $`rm bun.lock`.cwd(dir);
  }

  ////////////////////////// POST SETUP DONE //////////////////////////

  const cmd = [bunExe(), command, ...args];

  console.log(redDebugPrefix, "SETUP DONE");
  console.log("-------------------------------- THE REAL TEST IS ABOUT TO HAPPEN --------------------------------");
  console.log(redShellPrefix, cmd.join(" "));

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

  if (process.env.SCANNER_TEST_DEBUG) {
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

    if (process.env.SCANNER_TEST_DEBUG === "before") {
      process.exit(1);
    }
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
    const str = decoder.decode(chunk);

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

  const exitCode = await proc.exited;

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
    console.log("[TEST DEBUG] Checking for partial install messages");
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
    } else if (scannerReturns === "fatal") {
      expect(errAndOut).toContain("FATAL:");
      expect(errAndOut).toContain("Test fatal error");
    }
  }

  if (scannerType !== "npm.bunfigonly" && !hasExistingNodeModules) {
    switch (scannerReturns) {
      case "fatal":
      case "warn": {
        // When there are fatal advisories OR warnings (with no TTY to prompt),
        // the installation is cancelled and packages should NOT be installed
        const files = await globEverything(dir);
        expect(files).not.toContain("node_modules/left-pad/package.json");
        break;
      }

      case "none": {
        // When there are no security issues, packages should be installed normally
        const files = await globEverything(dir);

        switch (command) {
          case "remove":
          case "uninstall": {
            for (const arg of args) {
              switch (linker) {
                case "hoisted": {
                  expect(files).not.toContain(`node_modules/${arg}/package.json`);
                  break;
                }

                case "isolated": {
                  const versionInRegistry = SimpleRegistry.packages[arg][0];
                  expect(files).not.toContain(
                    `node_modules/.bun/${arg}@${versionInRegistry}/node_modules/${arg}/package.json`,
                  );
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
                  expect(files).toContain(`node_modules/${arg}/package.json`);
                  break;
                }

                case "isolated": {
                  const versionInRegistry = SimpleRegistry.packages[arg][0];
                  expect(files).toContain(
                    `node_modules/.bun/${arg}@${versionInRegistry}/node_modules/${arg}/package.json`,
                  );
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
  } else if (command === "remove" || command === "uninstall") {
    if (args.length > 0) {
      expect(requestedPackages).toMatchSnapshot("requested-packages: remove with args");
      expect(requestedTarballs).toMatchSnapshot("requested-tarballs: remove with args");
    } else {
      expect(requestedPackages).toMatchSnapshot("requested-packages: remove without args");
      expect(requestedTarballs).toMatchSnapshot("requested-tarballs: remove without args");
    }
  } else {
    expect(requestedPackages).toMatchSnapshot("requested-packages: unknown command");
    expect(requestedTarballs).toMatchSnapshot("requested-tarballs: unknown command");
  }
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
      describe.each([true, false] as const)("(node_modules: %p)", hasExistingNodeModules => {
        describe.each(["hoisted", "isolated"] as const)("--linker=%s", linker => {
          describe.each(["local", "npm", "npm.bunfigonly"] as const)("(scanner: %s)", scannerType => {
            describe.each([true, false] as const)("(bun.lock exists: %p)", hasLockfile => {
              describe.each(["none", "warn", "fatal"] as const)("(advisories: %s)", scannerReturns => {
                if ((command === "add" || command === "uninstall" || command === "remove") && args.length === 0) {
                  // TODO(@alii): Test this case:
                  //  - Exit code 1
                  //  - No changes to disk
                  //  - Scanner does not run
                  return;
                }

                const testName = String(++i).padStart(4, "0");

                if (TESTS_TO_SKIP.has(testName)) {
                  return test.skip(testName, async () => {
                    // TODO
                  });
                }

                // npm.bunfigonly is the case where a scanner is a valid npm package name identifier
                // but is not referenced in package.json anywhere and is not in the lockfile, so the only knowledge
                // of this package's existence is the fact that it was defined in as the value in bunfig.toml
                // Therefore, we should fail because we don't know where to install it from
                const shouldFail =
                  scannerType === "npm.bunfigonly" || scannerReturns === "fatal" || scannerReturns === "warn";

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
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
