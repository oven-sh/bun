import { bunEnv, bunExe, isCI, isWindows, nodeModulesPackages, normalizeBunSnapshot, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SimpleRegistry } from "./simple-dummy-registry";

const CI_SAMPLE_PERCENT = 10; // only 10% of tests will run in CI because this matrix generates so many tests

function getTestName(testId: string, hasExistingNodeModules: boolean) {
  return `${testId} (${hasExistingNodeModules ? "with modules" : "without modules"})`;
}

interface SecurityScannerTestOptions {
  command: "install" | "update" | "add" | "remove" | "uninstall";
  args: readonly string[];
  hasExistingNodeModules: boolean;
  hasLockfile: boolean;
  linker: "hoisted" | "isolated";
  // "npm.bunfigonly" names the npm scanner in bunfig.toml without declaring it in package.json, so bun
  // has nowhere to install it from and every command fails before the scanner runs.
  scannerType: "local" | "npm" | "npm.bunfigonly";
  scannerReturns: "none" | "warn" | "fatal";

  // The prompt only exists for "warn": "none" needs no answer and "fatal" never asks.
  hasTTY: boolean;
  ttyResponse: "y" | "n";
}

const DO_TEST_DEBUG = process.env.SCANNER_TEST_DEBUG === "true";

const SCANNER_PACKAGE = "test-security-scanner";

const versionOf = (name: string) => SimpleRegistry.packages[name][0];
const nameWithVersion = (name: string) => `${name}@${versionOf(name)}`;
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Every package an install of `roots` ends up with. The first entry is the first root: bun hands the
 * scanner its packages in this order, and both test scanners flag `packages[0]`.
 */
function installTree(roots: readonly string[]): string[] {
  const tree: string[] = [];
  const queue = [...roots];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (tree.includes(name)) continue;
    tree.push(name);
    queue.push(...Object.keys(SimpleRegistry.dependencies[name]));
  }
  return tree;
}

/** `dependencies` of the package.json each case starts from. */
function fixtureDependencies({ command, args, scannerType }: SecurityScannerTestOptions): Record<string, string> {
  return {
    "left-pad": versionOf("left-pad"),

    // For remove/uninstall commands, add the packages we're trying to remove
    ...(command === "remove" || command === "uninstall"
      ? { "is-even": versionOf("is-even"), "is-odd": versionOf("is-odd") }
      : {}),

    // `bun update <name>` only updates a declared dependency; it never adds one
    ...(command === "update" ? Object.fromEntries(args.map(arg => [arg, versionOf(arg)])) : {}),

    // For npm scanner, add it to dependencies so it gets installed
    ...(scannerType === "npm" ? { [SCANNER_PACKAGE]: versionOf(SCANNER_PACKAGE) } : {}),
  };
}

interface ProjectState {
  /** `nodeModulesPackages()` of the project: one `<dir>/<name>@<version>` line per extracted package. */
  installedPackages: string[];
  packageJsonDependencies: Record<string, string>;
  /** Keys of the `packages` section of bun.lock, or null when there is no bun.lock. */
  lockfilePackages: string[] | null;
}

interface CommandResult extends ProjectState {
  exitCode: number;
  /** Without a TTY each stream is captured on its own. */
  stdout?: string;
  stderr?: string;
  /** With a TTY this is everything the terminal received: both streams plus the echoed answer. */
  terminal?: string;
  /** The `SCANNER_RAN` lines the scanner itself printed, taken out of the stream(s) above. */
  scannerOutput: string[];
  requestedPackages: string[];
  requestedTarballs: string[];
}

/** The `installedPackages` line for one package, depending on where the linker puts it. */
function packageLocation(linker: SecurityScannerTestOptions["linker"], name: string): string {
  const folder =
    linker === "hoisted" ? `node_modules/${name}` : `node_modules/.bun/${nameWithVersion(name)}/node_modules/${name}`;
  return `${folder}/${nameWithVersion(name)}`;
}

/** What a case must look like before the command runs, and what the command must produce. */
function expectationsFor(options: SecurityScannerTestOptions): { before: ProjectState; after: CommandResult } {
  const {
    command,
    args,
    hasExistingNodeModules,
    hasLockfile,
    linker,
    scannerType,
    scannerReturns,
    hasTTY,
    ttyResponse,
  } = options;
  // `bun install <pkg>` is `bun add <pkg>`, and `bun uninstall` is `bun remove`.
  const adds = command === "add" || (command === "install" && args.length > 0);
  const removes = command === "remove" || command === "uninstall";
  const updates = command === "update";

  const dependenciesBefore = fixtureDependencies(options);
  const rootsBefore = Object.keys(dependenciesBefore);
  // add/remove edit the root dependencies before anything is resolved or scanned, even if the scanner cancels later.
  const roots = adds
    ? [...new Set([...rootsBefore, ...args])]
    : removes
      ? rootsBefore.filter(d => !args.includes(d))
      : rootsBefore;
  const treeBefore = installTree(rootsBefore);
  const tree = installTree(roots);
  const installedBefore = hasExistingNodeModules ? treeBefore : [];

  const scannerRuns = scannerType !== "npm.bunfigonly";
  // Without node_modules bun has to install the npm scanner before it can run it, whatever happens afterwards.
  const installsScannerFirst = scannerType === "npm" && !hasExistingNodeModules;
  // add and `update <pkg>` scan what they were asked for; everything else scans the whole tree, root
  // dependencies in name order.
  const scanned = adds || (updates && args.length > 0) ? installTree(args) : installTree([...roots].sort());
  const flagged = scanned[0];
  const proceeds =
    scannerRuns && (scannerReturns === "none" || (scannerReturns === "warn" && hasTTY && ttyResponse === "y"));

  // install and remove trust an existing lockfile, add and update always re-resolve what they were given.
  let manifests: string[];
  if (!hasLockfile) {
    manifests = tree;
  } else if (updates) {
    manifests = args.length > 0 ? [...args] : rootsBefore;
  } else if (adds) {
    manifests = installTree(args).filter(name => args.includes(name) || !treeBefore.includes(name));
  } else {
    manifests = [];
  }
  const resolves = !hasLockfile || adds || updates;
  // Downloads wait for the scanner's verdict. Only the scanner's own install happens before it.
  const downloads = proceeds
    ? tree.filter(name => !installedBefore.includes(name))
    : installsScannerFirst
      ? [SCANNER_PACKAGE]
      : [];
  const newlyInstalled = tree.filter(
    name => !installedBefore.includes(name) && !(installsScannerFirst && name === SCANNER_PACKAGE),
  );
  // remove reports how many of its arguments left the lockfile, which takes a lockfile to compare against.
  const removedFromLockfile = removes && hasLockfile ? args.filter(arg => !tree.includes(arg)).length : 0;
  const savesLockfile = proceeds && (!hasLockfile || adds || removes);

  function summary(): string {
    if (newlyInstalled.length > 0) {
      const added = roots
        .filter(name => newlyInstalled.includes(name) && !(adds && args.includes(name)))
        .sort()
        .map(name => `+ ${nameWithVersion(name)}`);
      const requested = adds ? args.map(name => `installed ${nameWithVersion(name)}`) : [];
      const lines = [added, requested].filter(block => block.length > 0).map(block => block.join("\n"));
      lines.push(`${count(newlyInstalled.length, "package")} installed [<time>]`);
      return lines.join("\n\n") + (removedFromLockfile > 0 ? `\nRemoved: ${removedFromLockfile}` : "");
    }
    if (!removes) {
      // The package count includes the root package. The isolated linker counts the root as an install too.
      const packages = count(tree.length + 1, "package");
      return linker === "hoisted"
        ? `Checked ${count(tree.length, "install")} across ${packages} (no changes) [<time>]`
        : `Done! Checked ${packages} (no changes) [<time>]`;
    }
    // With nothing to install, remove lists the names it dropped from package.json (again only with a lockfile
    // to compare against), then either the count of packages that left the lockfile or just the timing.
    const dropped = hasLockfile ? args.map(arg => `- ${arg}\n`).join("") : "";
    return (
      dropped +
      (removedFromLockfile > 0 ? `${count(removedFromLockfile, "package")} removed [<time>]` : "[<time>] done")
    );
  }

  // bun's output in the order it appears on a terminal. Without a TTY the two streams are read separately,
  // so only the order within each stream matters there.
  const output: [stream: "stdout" | "stderr" | "echo", text: string][] = [];
  output.push(["stdout", `bun ${adds ? "add" : removes ? "remove" : command} <version> (<revision>)\n`]);
  if (resolves) {
    // One task per manifest fetched plus one per package resolved from it. Every manifest here resolves exactly one package.
    output.push(["stderr", `Resolving dependencies\nResolved, downloaded and extracted [${manifests.length * 2}]\n`]);
  }
  if (installsScannerFirst) {
    output.push([
      "stdout",
      "Attempting to install security scanner from npm...\nSecurity scanner installed successfully.\n",
    ]);
  }
  if (!scannerRuns) {
    output.push([
      "stderr",
      `error: Security scanner '${SCANNER_PACKAGE}' is configured in bunfig.toml but is not installed.\n` +
        `  To install it, run: bun add --dev ${SCANNER_PACKAGE}\n` +
        "error: security scanner failed: SecurityScannerNotInDependencies\n",
    ]);
  } else if (scannerReturns === "fatal") {
    output.push([
      "stdout",
      `\n  FATAL: ${flagged}\n    via test-app › ${flagged}\n    Test fatal error\n\n1 advisory (1 fatal)\n`,
    ]);
    output.push(["stdout", "Installation aborted due to fatal security advisories\n"]);
  } else if (scannerReturns === "warn") {
    output.push([
      "stdout",
      `\n  WARNING: ${flagged}\n    via test-app › ${flagged}\n    Test warning\n\n1 advisory (1 warning)\n`,
    ]);
    if (!hasTTY) {
      output.push([
        "stdout",
        "\nSecurity warnings found. Cannot prompt for confirmation (no TTY).\nInstallation cancelled.\n",
      ]);
    } else {
      output.push(["stdout", "\nSecurity warnings found. Continue anyway? [y/N] "]);
      output.push(["echo", `${ttyResponse}\n`]);
      output.push(["stdout", proceeds ? "\nContinuing with installation...\n\n" : "\nInstallation cancelled.\n"]);
    }
  }
  if (savesLockfile) output.push(["stderr", "Saved lockfile\n"]);
  if (proceeds) output.push(["stdout", `\n${summary()}`]);

  const textOf = (streams: readonly string[]) =>
    output
      .filter(([stream]) => streams.includes(stream))
      .map(([, text]) => text)
      .join("")
      .trim();

  let installedAfter: string[];
  if (!proceeds) {
    installedAfter = installsScannerFirst ? [...installedBefore, SCANNER_PACKAGE] : installedBefore;
  } else if (removes && hasExistingNodeModules && linker === "isolated") {
    // The isolated linker only unlinks a removed package, its store entry stays behind.
    installedAfter = installedBefore;
  } else {
    // `remove is-even` without node_modules installs is-even: it is still a dependency of is-odd. This is what
    // https://github.com/oven-sh/bun/issues/22255 describes, its reproduction has the same dependency graph.
    installedAfter = tree;
  }

  let dependenciesAfter = dependenciesBefore;
  if (proceeds && adds) {
    dependenciesAfter = { ...dependenciesBefore, ...Object.fromEntries(args.map(arg => [arg, `^${versionOf(arg)}`])) };
  } else if (proceeds && removes) {
    dependenciesAfter = Object.fromEntries(Object.entries(dependenciesBefore).filter(([name]) => !args.includes(name)));
  }

  const packageLocations = (names: readonly string[]) => names.map(name => packageLocation(linker, name)).sort();

  return {
    before: {
      installedPackages: packageLocations(installedBefore),
      packageJsonDependencies: dependenciesBefore,
      lockfilePackages: hasLockfile ? [...treeBefore].sort() : null,
    },
    after: {
      exitCode: proceeds ? 0 : 1,
      ...(hasTTY
        ? { terminal: textOf(["stdout", "stderr", "echo"]) }
        : { stdout: textOf(["stdout"]), stderr: textOf(["stderr"]) }),
      scannerOutput: scannerRuns ? [`SCANNER_RAN: ${scanned.length} packages`] : [],
      installedPackages: packageLocations(installedAfter),
      packageJsonDependencies: dependenciesAfter,
      lockfilePackages: proceeds ? [...tree].sort() : hasLockfile ? [...treeBefore].sort() : null,
      requestedPackages: [...manifests].sort(),
      requestedTarballs: downloads.map(name => `/${name}-${versionOf(name)}.tgz`).sort(),
    },
  };
}

function localScannerSource(scannerReturns: SecurityScannerTestOptions["scannerReturns"]): string {
  // Same behavior as the test-security-scanner-1.0.0-*.tgz fixtures, see generate-scanner-tarballs.ts
  const advisory =
    scannerReturns === "none"
      ? ""
      : `if (payload.packages.length > 0) {
          results.push({
            package: payload.packages[0].name,
            level: ${JSON.stringify(scannerReturns)},
            description: ${JSON.stringify(scannerReturns === "warn" ? "Test warning" : "Test fatal error")},
          });
        }`;
  return `export const scanner = {
    version: "1",
    scan: async function (payload) {
      console.error("SCANNER_RAN: " + payload.packages.length + " packages");
      const results = [];
      ${advisory}
      return results;
    },
  };`;
}

async function readProjectState(dir: string): Promise<ProjectState> {
  const lockfile = Bun.file(join(dir, "bun.lock"));
  return {
    // With the cache disabled bun keeps the tarballs it extracts in node_modules/.cache. Those are not installs.
    installedPackages: nodeModulesPackages(dir)
      .split("\n")
      .filter(line => line !== "" && !line.startsWith("node_modules/.cache/")),
    packageJsonDependencies: (await Bun.file(join(dir, "package.json")).json()).dependencies,
    lockfilePackages: (await lockfile.exists())
      ? Object.keys((Bun.JSONC.parse(await lockfile.text()) as { packages: Record<string, unknown> }).packages).sort()
      : null,
  };
}

/** Normalizes one captured stream, taking the scanner's own lines out of it. */
function normalizeOutput(raw: string, dir: string): { text: string; scannerOutput: string[] } {
  const scannerOutput: string[] = [];
  const text = raw
    .replaceAll("\r\n", "\n")
    // The scanner writes straight to the inherited stderr, so where its lines land relative to bun's own
    // output is up to process scheduling. Compare them on their own.
    .replace(/^SCANNER_RAN: .*\n?/gm, line => {
      scannerOutput.push(line.trim());
      return "";
    })
    // Debug builds print these two and release builds do not: `debug warn:` diagnostics, and the timing
    // line bun adds when a scan takes longer than a second.
    .replace(/^debug warn: .*\n?/gm, "")
    .replace(/\[[^\]\n]*\] Scanning \d+ packages? took \d+ms\n?/g, "")
    .replace(/\[\d+\.\d\dm?s\]/g, "[<time>]");
  return { text: normalizeBunSnapshot(text, dir), scannerOutput };
}

async function runPiped(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    // Anything but a TTY: bun must report that it cannot prompt instead of waiting for an answer.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function runInTerminal(cmd: string[], cwd: string, answer: SecurityScannerTestOptions["ttyResponse"]) {
  const decoder = new TextDecoder();
  let terminal = "";
  let answered = false;
  const closed = Promise.withResolvers<void>();

  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: bunEnv,
    terminal: {
      cols: 80,
      rows: 24,
      data(pty, chunk) {
        terminal += decoder.decode(chunk, { stream: true });
        if (!answered && terminal.includes("Continue anyway? [y/N]")) {
          answered = true;
          pty.write(`${answer}\n`);
        }
      },
      // Output can still be in flight when the process exits. A terminal created by the spawn is closed
      // once the child exits, after the remaining output was delivered, and that close ends up here.
      exit() {
        closed.resolve();
      },
    },
  });
  const [exitCode] = await Promise.all([proc.exited, closed.promise]);
  terminal += decoder.decode();
  return { terminal, exitCode };
}

async function runSecurityScannerTest(expect: typeof import("bun:test").expect, options: SecurityScannerTestOptions) {
  const {
    command,
    args,
    hasExistingNodeModules,
    hasLockfile,
    linker,
    scannerType,
    scannerReturns,
    hasTTY,
    ttyResponse,
  } = options;
  const expected = expectationsFor(options);

  // Every case gets its own registry: the request log and the scanner tarball it serves are per case.
  using registry = new SimpleRegistry(DO_TEST_DEBUG);
  const registryUrl = `http://localhost:${await registry.start()}`;
  registry.setScannerBehavior(scannerReturns);

  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      { name: "test-app", version: "1.0.0", dependencies: expected.before.packageJsonDependencies },
      null,
      "\t",
    ),
  };
  if (scannerType === "local") {
    files["scanner.js"] = localScannerSource(scannerReturns);
  }
  using tmp = tempDir("scanner-matrix", files);
  const dir = String(tmp);

  // The manifest cache is off for both installs: the setup install writes its manifests to the cache
  // asynchronously and does not wait for those writes before exiting, so with the cache on, which manifests
  // the command under test requests would depend on whether they had landed.
  const cache = { disable: true, disableManifest: true };
  const writeBunfig = (scanner?: string) =>
    Bun.write(
      join(dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { cache, linker, registry: `${registryUrl}/`, ...(scanner ? { security: { scanner } } : {}) },
      }),
    );

  if (hasExistingNodeModules || hasLockfile) {
    await writeBunfig();
    const setup = await runPiped([bunExe(), "install"], dir);
    if (setup.exitCode !== 0) {
      throw new Error(`setup install exited with ${setup.exitCode}:\n${setup.stderr}`);
    }
    if (!hasExistingNodeModules) await rm(join(dir, "node_modules"), { recursive: true });
    if (!hasLockfile) await rm(join(dir, "bun.lock"));
  }
  expect(await readProjectState(dir)).toEqual(expected.before);

  ////////////////////////// POST SETUP DONE //////////////////////////

  registry.clearRequestLog();
  await writeBunfig(scannerType === "local" ? "./scanner.js" : SCANNER_PACKAGE);

  const cmd = [bunExe(), command, ...args];
  const run = hasTTY ? await runInTerminal(cmd, dir, ttyResponse) : await runPiped(cmd, dir);

  if (DO_TEST_DEBUG) {
    console.log(`$ cd ${dir} && ${cmd.join(" ")}`, "\n", run);
  }

  const streams = "terminal" in run ? { terminal: run.terminal } : { stdout: run.stdout, stderr: run.stderr };
  const scannerOutput: string[] = [];
  const output: Record<string, string> = {};
  for (const [stream, raw] of Object.entries(streams)) {
    const normalized = normalizeOutput(raw, dir);
    output[stream] = normalized.text;
    scannerOutput.push(...normalized.scannerOutput);
  }

  const actual: CommandResult = {
    exitCode: run.exitCode,
    ...output,
    scannerOutput,
    ...(await readProjectState(dir)),
    requestedPackages: registry.getRequestedPackages().sort(),
    requestedTarballs: registry.getRequestedTarballs().sort(),
  };
  expect(actual).toEqual(expected.after);
}

export function runSecurityScannerTests(selfModuleName: string, hasExistingNodeModules: boolean) {
  let i = 0;

  const { describe, expect, test } = Bun.jest(selfModuleName);

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

                const skip =
                  // PTY not supported on Windows
                  (hasTTY && isWindows) ||
                  // `uninstall` is the same as `remove`, optimising for CI time here
                  (isCI && command === "uninstall") ||
                  (isCI && Math.random() < (100 - CI_SAMPLE_PERCENT) / 100);

                if (skip) {
                  // A plain test.skip ends the concurrent group it sits in, so with most of the matrix skipped the
                  // cases that do run would run one at a time.
                  return test.concurrent.skip(testName, () => {});
                }

                // Every case has its own directory and registry, so the whole matrix can run at once.
                test.concurrent(testName, async () => {
                  await runSecurityScannerTest(expect, {
                    command,
                    args,
                    hasExistingNodeModules,
                    hasLockfile,
                    linker,
                    scannerType,
                    scannerReturns,
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
