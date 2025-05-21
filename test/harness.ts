/**
 * This file is loaded in every test file in the repository.
 *
 * Avoid adding external dependencies here so that we can still run some tests
 * without always needing to run `bun install` in development.
 */

import { gc as bunGC, sleepSync, spawnSync, unsafe, which, write } from "bun";
import { heapStats } from "bun:jsc";
import { fork, ChildProcess } from "child_process";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile, readlink, writeFile, readdir, rm } from "fs/promises";
import fs, { closeSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join } from "path";

type Awaitable<T> = T | Promise<T>;

export const BREAKING_CHANGES_BUN_1_2 = false;

export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isPosix = isMacOS || isLinux;
export const isWindows = process.platform === "win32";
export const isIntelMacOS = isMacOS && process.arch === "x64";
export const isDebug = Bun.version.includes("debug");
export const isCI = process.env.CI !== undefined;
export const libcFamily: "glibc" | "musl" =
  process.platform !== "linux"
    ? "glibc"
    : // process.report.getReport() has incorrect type definitions.
      (process.report.getReport() as any).header.glibcVersionRuntime
      ? "glibc"
      : "musl";

export const isMusl = isLinux && libcFamily === "musl";
export const isGlibc = isLinux && libcFamily === "glibc";
export const isBuildKite = process.env.BUILDKITE === "true";
export const isVerbose = process.env.DEBUG === "1";

// Use these to mark a test as flaky or broken.
// This will help us keep track of these tests.
//
// test.todoIf(isFlaky && isMacOS)("this test is flaky");
export const isFlaky = isCI;
export const isBroken = isCI;
export const isASAN = basename(process.execPath).includes("bun-asan");

export const bunEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GITHUB_ACTIONS: "false",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  TZ: "Etc/UTC",
  CI: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  BUN_GARBAGE_COLLECTOR_LEVEL: process.env.BUN_GARBAGE_COLLECTOR_LEVEL || "0",
  BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE: "1",
  BUN_DEBUG_linkerctx: "0",
};

const ciEnv = { ...bunEnv };

if (isASAN) {
  bunEnv.ASAN_OPTIONS ??= "allow_user_segv_handler=1";
}

if (isWindows) {
  bunEnv.SHELLOPTS = "igncr"; // Ignore carriage return
}

for (let key in bunEnv) {
  if (bunEnv[key] === undefined) {
    delete ciEnv[key];
    delete bunEnv[key];
  }

  if (key.startsWith("BUN_DEBUG_") && key !== "BUN_DEBUG_QUIET_LOGS") {
    delete ciEnv[key];
    delete bunEnv[key];
  }

  if (key.startsWith("BUILDKITE")) {
    delete bunEnv[key];
    delete process.env[key];
  }
}

delete bunEnv.NODE_ENV;

if (isDebug) {
  // This makes debug build memory leak tests more reliable.
  // The code for dumping out the debug build transpiled source code has leaks.
  bunEnv.BUN_DEBUG_NO_DUMP = "1";
}

export function bunExe() {
  if (isWindows) return process.execPath.replaceAll("\\", "/");
  return process.execPath;
}

export function nodeExe(): string | null {
  return which("node") || null;
}

export function shellExe(): string {
  return isWindows ? "pwsh" : "bash";
}

export function gc(force = true) {
  bunGC(force);
}

/**
 * The garbage collector is not 100% deterministic
 *
 * We want to assert that SOME of the objects are collected
 * But we cannot reliably assert that ALL of them are collected
 *
 * Therefore, we check that the count is less than or equal to the expected count
 *
 * @param type
 * @param count
 * @param maxWait
 * @returns
 */
export async function expectMaxObjectTypeCount(
  expect: typeof import("bun:test").expect,
  type: string,
  count: number,
  maxWait = 1000,
) {
  var { heapStats } = require("bun:jsc");

  gc();
  if (heapStats().objectTypeCounts[type] <= count) return;
  gc(true);
  for (const wait = 20; maxWait > 0; maxWait -= wait) {
    if (heapStats().objectTypeCounts[type] <= count) break;
    await Bun.sleep(wait);
    gc();
  }
  expect(heapStats().objectTypeCounts[type] || 0).toBeLessThanOrEqual(count);
}

// we must ensure that finalizers are run
// so that the reference-counting logic is exercised
export function gcTick(trace = false) {
  trace && console.trace("");
  // console.trace("hello");
  gc();
  return Bun.sleep(0);
}

export function withoutAggressiveGC(block: () => unknown) {
  if (!unsafe.gcAggressionLevel) return block();

  const origGC = unsafe.gcAggressionLevel();
  unsafe.gcAggressionLevel(0);
  try {
    return block();
  } finally {
    unsafe.gcAggressionLevel(origGC);
  }
}

export function hideFromStackTrace(block: CallableFunction) {
  Object.defineProperty(block, "name", {
    value: "::bunternal::",
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

export type DirectoryTree = {
  [name: string]:
    | string
    | Buffer
    | DirectoryTree
    | ((opts: { root: string }) => Awaitable<string | Buffer | DirectoryTree>);
};

export async function makeTree(base: string, tree: DirectoryTree) {
  const isDirectoryTree = (value: string | DirectoryTree | Buffer): value is DirectoryTree =>
    typeof value === "object" && value && typeof value?.byteLength === "undefined";

  for (const [name, raw_contents] of Object.entries(tree)) {
    const contents = typeof raw_contents === "function" ? await raw_contents({ root: base }) : raw_contents;
    const joined = join(base, name);
    if (name.includes("/")) {
      const dir = dirname(name);
      if (dir !== name && dir !== ".") {
        fs.mkdirSync(join(base, dir), { recursive: true });
      }
    }
    if (isDirectoryTree(contents)) {
      fs.mkdirSync(joined);
      makeTree(joined, contents);
      continue;
    }
    fs.writeFileSync(joined, contents);
  }
}

export function makeTreeSync(base: string, tree: DirectoryTree) {
  const isDirectoryTree = (value: string | DirectoryTree | Buffer): value is DirectoryTree =>
    typeof value === "object" && value && typeof value?.byteLength === "undefined";

  for (const [name, raw_contents] of Object.entries(tree)) {
    const contents = (typeof raw_contents === "function" ? raw_contents({ root: base }) : raw_contents) as string;
    const joined = join(base, name);
    if (name.includes("/")) {
      const dir = dirname(name);
      if (dir !== name && dir !== ".") {
        fs.mkdirSync(join(base, dir), { recursive: true });
      }
    }
    if (isDirectoryTree(contents)) {
      fs.mkdirSync(joined);
      makeTreeSync(joined, contents);
      continue;
    }
    fs.writeFileSync(joined, contents);
  }
}

/**
 * Recursively create files within a new temporary directory.
 *
 * @param basename prefix of the new temporary directory
 * @param files directory tree. Each key is a folder or file, and each value is the contents of the file. Use objects for directories.
 * @returns an absolute path to the new temporary directory
 *
 * @example
 * ```ts
 * const dir = tempDirWithFiles("my-test", {
 *   "index.js": `import foo from "./src/foo";`,
 *   "src": {
 *     "foo.js": `export default "foo";`,
 *   },
 * });
 * ```
 */
export function tempDirWithFiles(basename: string, files: DirectoryTree): string {
  const base = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), basename + "_"));
  makeTreeSync(base, files);
  return base;
}

export function bunRun(file: string, env?: Record<string, string> | NodeJS.ProcessEnv) {
  var path = require("path");
  const result = Bun.spawnSync([bunExe(), file], {
    cwd: path.dirname(file),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
  return {
    stdout: result.stdout.toString("utf8").trim(),
    stderr: result.stderr.toString("utf8").trim(),
  };
}

export function bunTest(file: string, env?: Record<string, string>) {
  var path = require("path");
  const result = Bun.spawnSync([bunExe(), "test", path.basename(file)], {
    cwd: path.dirname(file),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
  return {
    stdout: result.stdout.toString("utf8").trim(),
    stderr: result.stderr.toString("utf8").trim(),
  };
}

export function bunRunAsScript(
  dir: string,
  script: string,
  env?: Record<string, string | undefined>,
  execArgv?: string[],
) {
  const result = Bun.spawnSync([bunExe(), ...(execArgv ?? []), `run`, `${script}`], {
    cwd: dir,
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });

  if (!result.success) throw new Error(result.stderr.toString("utf8"));

  return {
    stdout: result.stdout.toString("utf8").trim(),
    stderr: result.stderr.toString("utf8").trim(),
  };
}

export function randomLoneSurrogate() {
  const n = randomRange(0, 2);
  if (n === 0) return randomLoneHighSurrogate();
  return randomLoneLowSurrogate();
}

export function randomInvalidSurrogatePair() {
  const low = randomLoneLowSurrogate();
  const high = randomLoneHighSurrogate();
  return `${low}${high}`;
}

// Generates a random lone high surrogate (from the range D800-DBFF)
export function randomLoneHighSurrogate() {
  return String.fromCharCode(randomRange(0xd800, 0xdbff));
}

// Generates a random lone high surrogate (from the range DC00-DFFF)
export function randomLoneLowSurrogate() {
  return String.fromCharCode(randomRange(0xdc00, 0xdfff));
}

function randomRange(low: number, high: number): number {
  return low + Math.floor(Math.random() * (high - low));
}

export function runWithError(cb: () => unknown): Error | undefined {
  try {
    cb();
  } catch (e) {
    return e as Error;
  }
  return undefined;
}

export async function runWithErrorPromise(cb: () => unknown): Promise<Error | undefined> {
  try {
    await cb();
  } catch (e) {
    return e as Error;
  }
  return undefined;
}

export function fakeNodeRun(dir: string, file: string | string[], env?: Record<string, string>) {
  var path = require("path");
  const result = Bun.spawnSync([bunExe(), "--bun", "node", ...(Array.isArray(file) ? file : [file])], {
    cwd: dir ?? path.dirname(file),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
  return {
    stdout: result.stdout.toString("utf8").trim(),
    stderr: result.stderr.toString("utf8").trim(),
  };
}

export function randomPort(): number {
  return 1024 + Math.floor(Math.random() * (65535 - 1024));
}

const binaryTypes = {
  "buffer": Buffer,
  "arraybuffer": ArrayBuffer,
  "uint8array": Uint8Array,
  "uint16array": Uint16Array,
  "uint32array": Uint32Array,
  "int8array": Int8Array,
  "int16array": Int16Array,
  "int32array": Int32Array,
  "float16array": globalThis.Float16Array,
  "float32array": Float32Array,
  "float64array": Float64Array,
} as const;
if (expect.extend)
  expect.extend({
    toHaveTestTimedOutAfter(actual: any, expected: number) {
      if (typeof actual !== "string") {
        return {
          pass: false,
          message: () => `Expected ${actual} to be a string`,
        };
      }

      const preStartI = actual.indexOf("timed out after ");
      if (preStartI === -1) {
        return {
          pass: false,
          message: () => `Expected ${actual} to contain "timed out after "`,
        };
      }
      const startI = preStartI + "timed out after ".length;
      const endI = actual.indexOf("ms", startI);
      if (endI === -1) {
        return {
          pass: false,
          message: () => `Expected ${actual} to contain "ms" after "timed out after "`,
        };
      }
      const int = parseInt(actual.slice(startI, endI));
      if (!Number.isSafeInteger(int)) {
        return {
          pass: false,
          message: () => `Expected ${int} to be a safe integer`,
        };
      }

      return {
        pass: int >= expected,
        message: () => `Expected ${int} to be >= ${expected}`,
      };
    },
    toBeBinaryType(actual: any, expected: keyof typeof binaryTypes) {
      switch (expected) {
        case "buffer":
          return {
            pass: Buffer.isBuffer(actual),
            message: () => `Expected ${actual} to be buffer`,
          };
        case "arraybuffer":
          return {
            pass: actual instanceof ArrayBuffer,
            message: () => `Expected ${actual} to be ArrayBuffer`,
          };
        default: {
          const ctor = binaryTypes[expected];
          if (!ctor) {
            return {
              pass: false,
              message: () => `Expected ${expected} to be a binary type`,
            };
          }

          return {
            pass: actual instanceof ctor,
            message: () => `Expected ${actual} to be ${expected}`,
          };
        }
      }
    },
    toRun(cmds: string[], optionalStdout?: string, expectedCode: number = 0) {
      const result = Bun.spawnSync({
        cmd: [bunExe(), ...cmds],
        env: bunEnv,
        stdio: ["inherit", "pipe", "inherit"],
      });

      if (result.exitCode !== expectedCode) {
        return {
          pass: false,
          message: () => `Command ${cmds.join(" ")} failed:` + "\n" + result.stdout.toString("utf-8"),
        };
      }

      if (optionalStdout != null) {
        return {
          pass: result.stdout.toString("utf-8") === optionalStdout,
          message: () =>
            `Expected ${cmds.join(" ")} to output ${optionalStdout} but got ${result.stdout.toString("utf-8")}`,
        };
      }

      return {
        pass: true,
        message: () => `Expected ${cmds.join(" ")} to fail`,
      };
    },
    toThrowWithCode(fn: CallableFunction, cls: CallableFunction, code: string) {
      try {
        fn();
        return {
          pass: false,
          message: () => `Received function did not throw`,
        };
      } catch (e) {
        // expect(e).toBeInstanceOf(cls);
        if (!(e instanceof cls)) {
          return {
            pass: false,
            message: () => `Expected error to be instanceof ${cls.name}; got ${e.__proto__.constructor.name}`,
          };
        }

        // expect(e).toHaveProperty("code");
        if (!("code" in e)) {
          return {
            pass: false,
            message: () => `Expected error to have property 'code'; got ${e}`,
          };
        }

        // expect(e.code).toEqual(code);
        if (e.code !== code) {
          return {
            pass: false,
            message: () => `Expected error to have code '${code}'; got ${e.code}`,
          };
        }

        return {
          pass: true,
        };
      }
    },
    async toThrowWithCodeAsync(fn: CallableFunction, cls: CallableFunction, code: string) {
      try {
        await fn();
        return {
          pass: false,
          message: () => `Received function did not throw`,
        };
      } catch (e) {
        // expect(e).toBeInstanceOf(cls);
        if (!(e instanceof cls)) {
          return {
            pass: false,
            message: () => `Expected error to be instanceof ${cls.name}; got ${e.__proto__.constructor.name}`,
          };
        }

        // expect(e).toHaveProperty("code");
        if (!("code" in e)) {
          return {
            pass: false,
            message: () => `Expected error to have property 'code'; got ${e}`,
          };
        }

        // expect(e.code).toEqual(code);
        if (e.code !== code) {
          return {
            pass: false,
            message: () => `Expected error to have code '${code}'; got ${e.code}`,
          };
        }

        return {
          pass: true,
        };
      }
    },
    toBeLatin1String(actual: unknown) {
      if ((actual as string).isLatin1()) {
        return {
          pass: true,
          message: () => `Expected ${actual} to be a Latin1 string`,
        };
      }

      return {
        pass: false,
        message: () => `Expected ${actual} to be a Latin1 string`,
      };
    },
    toBeUTF16String(actual: unknown) {
      if ((actual as string).isUTF16()) {
        return {
          pass: true,
          message: () => `Expected ${actual} to be a UTF16 string`,
        };
      }

      return {
        pass: false,
        message: () => `Expected ${actual} to be a UTF16 string`,
      };
    },
  });

export function ospath(path: string) {
  if (isWindows) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

/**
 * Iterates through each tree in the lockfile, checking for each package
 * on disk. Also requires each package dependency. Not tested well for
 * non-npm packages (links, folders, git dependencies, etc.)
 */
export async function toMatchNodeModulesAt(lockfile: any, root: string) {
  function shouldSkip(pkg: any, dep: any): boolean {
    // Band-aid as toMatchNodeModulesAt will sometimes ask this function
    // if a package depends on itself
    if (pkg?.name === dep?.name) return true;
    return (
      !pkg ||
      !pkg.resolution ||
      dep.behavior.optional ||
      (dep.behavior.dev && pkg.id !== 0) ||
      (pkg.arch && pkg.arch !== process.arch)
    );
  }
  for (const { path, dependencies } of lockfile.trees) {
    for (const { package_id, id } of Object.values(dependencies) as any[]) {
      const treeDep = lockfile.dependencies[id];
      const treePkg = lockfile.packages[package_id];
      if (shouldSkip(treePkg, treeDep)) continue;

      const treeDepPath = join(root, path, treeDep.name);

      switch (treePkg.resolution.tag) {
        case "npm":
          const onDisk = await Bun.file(join(treeDepPath, "package.json")).json();
          if (!Bun.deepMatch({ name: treePkg.name, version: treePkg.resolution.value }, onDisk)) {
            return {
              pass: false,
              message: () => `
Expected at ${join(path, treeDep.name)}: ${JSON.stringify({ name: treePkg.name, version: treePkg.resolution.value })}
Received ${JSON.stringify({ name: onDisk.name, version: onDisk.version })}`,
            };
          }

          // Ok, we've confirmed the package exists and has the correct version. Now go through
          // each of its transitive dependencies and confirm the same.
          for (const depId of treePkg.dependencies) {
            const dep = lockfile.dependencies[depId];
            const pkg = lockfile.packages[dep.package_id];
            if (shouldSkip(pkg, dep)) continue;

            try {
              const resolved = await Bun.file(Bun.resolveSync(join(dep.name, "package.json"), treeDepPath)).json();
              switch (pkg.resolution.tag) {
                case "npm":
                  const name = dep.is_alias ? dep.npm.name : dep.name;
                  if (!Bun.deepMatch({ name, version: pkg.resolution.value }, resolved)) {
                    if (dep.literal === "*") {
                      // allow any version, just needs to be resolvable
                      continue;
                    }
                    if (dep.behavior.peer && dep.npm) {
                      // allow peer dependencies to not match exactly, but still satisfy
                      if (Bun.semver.satisfies(pkg.resolution.value, dep.npm.version)) continue;
                    }
                    return {
                      pass: false,
                      message: () =>
                        `Expected ${dep.name} to have version ${pkg.resolution.value} in ${treeDepPath}, but got ${resolved.version}`,
                    };
                  }
                  break;
              }
            } catch (e) {
              return {
                pass: false,
                message: () => `Expected ${dep.name} to be resolvable in ${treeDepPath}`,
              };
            }
          }
          break;

        default:
          if (!fs.existsSync(treeDepPath)) {
            return {
              pass: false,
              message: () => `Expected ${treePkg.resolution.tag} "${treeDepPath}" to exist`,
            };
          }

          for (const depId of treePkg.dependencies) {
            const dep = lockfile.dependencies[depId];
            const pkg = lockfile.packages[dep.package_id];
            if (shouldSkip(pkg, dep)) continue;
            try {
              const resolved = await Bun.file(Bun.resolveSync(join(dep.name, "package.json"), treeDepPath)).json();
              switch (pkg.resolution.tag) {
                case "npm":
                  const name = dep.is_alias ? dep.npm.name : dep.name;
                  if (!Bun.deepMatch({ name, version: pkg.resolution.value }, resolved)) {
                    if (dep.literal === "*") {
                      // allow any version, just needs to be resolvable
                      continue;
                    }
                    // workspaces don't need a version
                    if (treePkg.resolution.tag === "workspace" && !resolved.version) continue;
                    if (dep.behavior.peer && dep.npm) {
                      // allow peer dependencies to not match exactly, but still satisfy
                      if (Bun.semver.satisfies(pkg.resolution.value, dep.npm.version)) continue;
                    }
                    return {
                      pass: false,
                      message: () =>
                        `Expected ${dep.name} to have version ${pkg.resolution.value} in ${treeDepPath}, but got ${resolved.version}`,
                    };
                  }
                  break;
              }
            } catch (e) {
              return {
                pass: false,
                message: () => `Expected ${dep.name} to be resolvable in ${treeDepPath}`,
              };
            }
          }

          break;
      }
    }
  }

  return {
    pass: true,
  };
}

export async function toHaveBins(actual: string[], expectedBins: string[]) {
  const message = () => `Expected ${actual} to be package bins ${expectedBins}`;

  if (isWindows) {
    for (var i = 0; i < actual.length; i += 2) {
      if (!actual[i].includes(expectedBins[i / 2]) || !actual[i + 1].includes(expectedBins[i / 2])) {
        return { pass: false, message };
      }
    }
    return { pass: true, message };
  }

  return { pass: actual.every((bin, i) => bin === expectedBins[i]), message };
}

export async function toBeValidBin(actual: string, expectedLinkPath: string) {
  const message = () => `Expected ${actual} to be a link to ${expectedLinkPath}`;

  if (isWindows) {
    const contents = await readFile(actual + ".bunx", "utf16le");
    const expected = expectedLinkPath.slice(3);
    return { pass: contents.includes(expected), message };
  }

  return { pass: (await readlink(actual)) === expectedLinkPath, message };
}

export async function toBeWorkspaceLink(actual: string, expectedLinkPath: string) {
  const message = () => `Expected ${actual} to be a link to ${expectedLinkPath}`;

  if (isWindows) {
    // junctions on windows will have an absolute path
    const pass = isAbsolute(actual) && actual.includes(expectedLinkPath.split("..").at(-1)!);
    return { pass, message };
  }

  const pass = actual === expectedLinkPath;
  return { pass, message };
}

export function getMaxFD(): number {
  if (isMacOS || isLinux) {
    let max = -1;
    // https://github.com/python/cpython/commit/e21a7a976a7e3368dc1eba0895e15c47cb06c810
    for (let entry of fs.readdirSync(isMacOS ? "/dev/fd" : "/proc/self/fd")) {
      const fd = parseInt(entry.trim(), 10);
      if (Number.isSafeInteger(fd) && fd >= 0) {
        max = Math.max(max, fd);
      }
    }

    if (max >= 0) {
      return max;
    }
  }

  const maxFD = openSync("/dev/null", "r");
  closeSync(maxFD);
  return maxFD;
}

// This is extremely frowned upon but I think it's easier to deal with than
// remembering to do this manually everywhere
declare global {
  interface Buffer {
    /**
     * **INTERNAL USE ONLY, NOT An API IN BUN**
     */
    toUnixString(): string;
  }

  interface String {
    /**
     * **INTERNAL USE ONLY, NOT An API IN BUN**
     */
    isLatin1(): boolean;
    /**
     * **INTERNAL USE ONLY, NOT An API IN BUN**
     */
    isUTF16(): boolean;
  }
}

Buffer.prototype.toUnixString = function () {
  return this.toString("utf-8").replaceAll("\r\n", "\n");
};

export function dockerExe(): string | null {
  return which("docker") || which("podman") || null;
}

export async function waitForPort(port: number, timeout: number = 60_000): Promise<void> {
  let deadline = Date.now() + Math.max(1, timeout);
  let error: unknown;
  while (Date.now() < deadline) {
    error = await new Promise(resolve => {
      Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          data: socket => {
            resolve(undefined);
            socket.end();
          },
          end: () => resolve(new Error("Socket closed")),
          error: (_, cause) => resolve(new Error("Socket error", { cause })),
          connectError: (_, cause) => resolve(new Error("Socket connect error", { cause })),
        },
      });
    });
    if (error) {
      await Bun.sleep(1000);
    } else {
      return;
    }
  }
  throw error;
}

export async function describeWithContainer(
  label: string,
  {
    image,
    env = {},
    args = [],
    archs,
  }: {
    image: string;
    env?: Record<string, string>;
    args?: string[];
    archs?: NodeJS.Architecture[];
  },
  fn: (port: number) => void,
) {
  describe(label, () => {
    const docker = dockerExe();
    if (!docker) {
      test.skip(`docker is not installed, skipped: ${image}`, () => {});
      return;
    }
    const { arch, platform } = process;
    if ((archs && !archs?.includes(arch)) || platform === "win32") {
      test.skip(`docker image is not supported on ${platform}/${arch}, skipped: ${image}`, () => {});
      return false;
    }
    let containerId: string;
    {
      const envs = Object.entries(env).map(([k, v]) => `-e${k}=${v}`);
      const { exitCode, stdout, stderr } = Bun.spawnSync({
        cmd: [docker, "run", "--rm", "-dPit", ...envs, image, ...args],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (exitCode !== 0) {
        process.stderr.write(stderr);
        test.skip(`docker container for ${image} failed to start`, () => {});
        return false;
      }
      containerId = stdout.toString("utf-8").trim();
    }
    let port: number;
    {
      const { exitCode, stdout, stderr } = Bun.spawnSync({
        cmd: [docker, "port", containerId],
        stdout: "pipe",
        stderr: "pipe",
      });
      if (exitCode !== 0) {
        process.stderr.write(stderr);
        test.skip(`docker container for ${image} failed to find a port`, () => {});
        return false;
      }
      const [firstPort] = stdout
        .toString("utf-8")
        .trim()
        .split("\n")
        .map(line => parseInt(line.split(":").pop()!));
      port = firstPort;
    }
    beforeAll(async () => {
      await waitForPort(port);
    });
    afterAll(() => {
      Bun.spawnSync({
        cmd: [docker, "rm", "-f", containerId],
        stdout: "ignore",
        stderr: "ignore",
      });
    });
    fn(port);
  });
}

export function osSlashes(path: string) {
  return isWindows ? path.replace(/\//g, "\\") : path;
}

import * as child_process from "node:child_process";
import { basename } from "node:path";

class WriteBlockedError extends Error {
  constructor(time) {
    super("Write blocked for " + (time | 0) + "ms");
    this.name = "WriteBlockedError";
  }
}
function failTestsOnBlockingWriteCall() {
  const prop = Object.getOwnPropertyDescriptor(child_process.ChildProcess.prototype, "stdin");
  const didAttachSymbol = Symbol("kDidAttach");
  if (prop) {
    Object.defineProperty(child_process.ChildProcess.prototype, "stdin", {
      ...prop,
      get() {
        const actual = prop.get.call(this);
        if (actual?.write && !actual.__proto__[didAttachSymbol]) {
          actual.__proto__[didAttachSymbol] = true;
          attachWriteMeasurement(actual);
        }
        return actual;
      },
    });
  }

  function attachWriteMeasurement(stream) {
    const prop = Object.getOwnPropertyDescriptor(stream.__proto__, "write");
    if (prop) {
      Object.defineProperty(stream.__proto__, "write", {
        ...prop,
        value(chunk, encoding, cb) {
          const start = performance.now();
          const rc = prop.value.apply(this, arguments);
          const end = performance.now();
          if (end - start > 8) {
            const err = new WriteBlockedError(end - start);
            throw err;
          }
          return rc;
        },
      });
    }
  }
}

failTestsOnBlockingWriteCall();

export function dumpStats() {
  const stats = heapStats();
  const { objectTypeCounts, protectedObjectTypeCounts } = stats;
  console.log({
    objects: Object.fromEntries(Object.entries(objectTypeCounts).sort()),
    protected: Object.fromEntries(Object.entries(protectedObjectTypeCounts).sort()),
  });
}

export function fillRepeating(dstBuffer: NodeJS.TypedArray, start: number, end: number) {
  let len = dstBuffer.length, // important: use indices length, not byte-length
    sLen = end - start,
    p = sLen; // set initial position = source sequence length

  // step 2: copy existing data doubling segment length per iteration
  while (p < len) {
    if (p + sLen > len) sLen = len - p; // if not power of 2, truncate last segment
    dstBuffer.copyWithin(p, start, sLen); // internal copy
    p += sLen; // add current length to offset
    sLen <<= 1; // double length for next segment
  }
}

function makeFlatPropertyMap(opts: object) {
  // return all properties of opts as paths for nested objects with dot notation
  // like { a: { b: 1 } } => { "a.b": 1 }
  // combining names of nested objects with dot notation
  // infinitely deep
  const ret: any = {};
  function recurse(obj: object, path = "") {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;

      if (value && typeof value === "object") {
        recurse(value, path ? `${path}.${key}` : key);
      } else {
        ret[path ? `${path}.${key}` : key] = value;
      }
    }
  }

  recurse(opts);
  return ret;
}

export function toTOMLString(opts: object) {
  // return a TOML string of the given options
  const props = makeFlatPropertyMap(opts);
  let ret = "";
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    ret += `${key} = ${JSON.stringify(value)}` + "\n";
  }
  return ret;
}

const shebang_posix = (program: string) => `#!/usr/bin/env ${program}
 `;

const shebang_windows = (program: string) => `0</* :{
   @echo off
   ${program} %~f0 %*
   exit /b %errorlevel%
 :} */0;
 `;

export function writeShebangScript(path: string, program: string, data: string) {
  if (!isWindows) {
    return writeFile(path, shebang_posix(program) + "\n" + data, { mode: 0o777 });
  } else {
    return writeFile(path + ".cmd", shebang_windows(program) + "\n" + data);
  }
}

export async function* forEachLine(iter: AsyncIterable<NodeJS.TypedArray | ArrayBufferLike>) {
  var decoder = new (require("string_decoder").StringDecoder)("utf8");
  var str = "";
  for await (const chunk of iter) {
    str += decoder.write(chunk);
    let i = str.indexOf("\n");
    while (i >= 0) {
      yield str.slice(0, i);
      str = str.slice(i + 1);
      i = str.indexOf("\n");
    }
  }

  str += decoder.end();
  {
    let i = str.indexOf("\n");
    while (i >= 0) {
      yield str.slice(0, i);
      str = str.slice(i + 1);
      i = str.indexOf("\n");
    }
  }

  if (str.length > 0) {
    yield str;
  }
}

export function joinP(...paths: string[]) {
  return join(...paths).replaceAll("\\", "/");
}

/**
 * TODO: see if this is the default behavior of node child_process APIs if so,
 * we need to do case-insensitive stuff within our Bun.spawn implementation
 *
 * Windows has case-insensitive environment variables, so sometimes an
 * object like { Path: "...", PATH: "..." } will be passed. Bun lets
 * the first one win, but we really want the LAST one to win.
 *
 * This is mostly needed if you want to override env vars, such like:
 *   env: {
 *     ...bunEnv,
 *     PATH: "my path override here",
 *   }
 * becomes
 *   env: mergeWindowEnvs([
 *     bunEnv,
 *     {
 *       PATH: "my path override here",
 *     },
 *   ])
 */
export function mergeWindowEnvs(envs: Record<string, string | undefined>[]) {
  const keys: Record<string, string | undefined> = {};
  const flat: Record<string, string | undefined> = {};
  for (const env of envs) {
    for (const key in env) {
      if (!env[key]) continue;
      const normalized = (keys[key.toUpperCase()] ??= key);
      flat[normalized] = env[key];
    }
  }
  return flat;
}

export function tmpdirSync(pattern: string = "bun.test."): string {
  return fs.mkdtempSync(join(fs.realpathSync.native(os.tmpdir()), pattern));
}

export async function runBunInstall(
  env: NodeJS.ProcessEnv,
  cwd: string,
  options?: {
    allowWarnings?: boolean;
    allowErrors?: boolean;
    expectedExitCode?: number;
    savesLockfile?: boolean;
    production?: boolean;
    frozenLockfile?: boolean;
    saveTextLockfile?: boolean;
    packages?: string[];
    verbose?: boolean;
  },
) {
  const production = options?.production ?? false;
  const args = production ? [bunExe(), "install", "--production"] : [bunExe(), "install"];
  if (options?.packages) {
    args.push(...options.packages);
  }
  if (production) {
    args.push("--production");
  }
  if (options?.frozenLockfile) {
    args.push("--frozen-lockfile");
  }
  if (options?.saveTextLockfile) {
    args.push("--save-text-lockfile");
  }
  if (options?.verbose) {
    args.push("--verbose");
  }
  const { stdout, stderr, exited } = Bun.spawn({
    cmd: args,
    cwd,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });
  expect(stdout).toBeDefined();
  expect(stderr).toBeDefined();
  let err = stderrForInstall(await new Response(stderr).text());
  expect(err).not.toContain("panic:");
  if (!options?.allowErrors) {
    expect(err).not.toContain("error:");
  }
  if (!options?.allowWarnings) {
    expect(err).not.toContain("warn:");
  }
  if ((options?.savesLockfile ?? true) && !production && !options?.frozenLockfile) {
    expect(err).toContain("Saved lockfile");
  }
  let out = await new Response(stdout).text();
  expect(await exited).toBe(options?.expectedExitCode ?? 0);
  return { out, err, exited };
}

// stderr with `slow filesystem` warning removed
export function stderrForInstall(err: string) {
  return err.replace(/warn: Slow filesystem.*/g, "");
}

export async function runBunUpdate(
  env: NodeJS.ProcessEnv,
  cwd: string,
  args?: string[],
): Promise<{ out: string[]; err: string; exitCode: number }> {
  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "update", ...(args ?? [])],
    cwd,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env,
  });

  let err = await Bun.readableStreamToText(stderr);
  let out = await Bun.readableStreamToText(stdout);
  let exitCode = await exited;
  if (exitCode !== 0) {
    console.log("stdout:", out);
    console.log("stderr:", err);
    expect().fail("bun update failed");
  }

  return { out: out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/), err, exitCode };
}

export async function pack(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "pm", "pack", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warning:");
  expect(err).not.toContain("failed");
  expect(err).not.toContain("panic:");

  const out = await Bun.readableStreamToText(stdout);

  const exitCode = await exited;
  expect(exitCode).toBe(0);

  return { out, err };
}

// If you need to modify, clone it
export const expiredTls = Object.freeze({
  cert: "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKLdQVPy90jjMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTkwMjAzMTQ0OTM1WhcNMjAwMjAzMTQ0OTM1WjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB\nCgKCAQEA7i7IIEdICTiSTVx+ma6xHxOtcbd6wGW3nkxlCkJ1UuV8NmY5ovMsGnGD\nhJJtUQ2j5ig5BcJUf3tezqCNW4tKnSOgSISfEAKvpn2BPvaFq3yx2Yjz0ruvcGKp\nDMZBXmB/AAtGyN/UFXzkrcfppmLHJTaBYGG6KnmU43gPkSDy4iw46CJFUOupc51A\nFIz7RsE7mbT1plCM8e75gfqaZSn2k+Wmy+8n1HGyYHhVISRVvPqkS7gVLSVEdTea\nUtKP1Vx/818/HDWk3oIvDVWI9CFH73elNxBkMH5zArSNIBTehdnehyAevjY4RaC/\nkK8rslO3e4EtJ9SnA4swOjCiqAIQEwIDAQABo1AwTjAdBgNVHQ4EFgQUv5rc9Smm\n9c4YnNf3hR49t4rH4yswHwYDVR0jBBgwFoAUv5rc9Smm9c4YnNf3hR49t4rH4ysw\nDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATcL9CAAXg0u//eYUAlQa\nL+l8yKHS1rsq1sdmx7pvsmfZ2g8ONQGfSF3TkzkI2OOnCBokeqAYuyT8awfdNUtE\nEHOihv4ZzhK2YZVuy0fHX2d4cCFeQpdxno7aN6B37qtsLIRZxkD8PU60Dfu9ea5F\nDDynnD0TUabna6a0iGn77yD8GPhjaJMOz3gMYjQFqsKL252isDVHEDbpVxIzxPmN\nw1+WK8zRNdunAcHikeoKCuAPvlZ83gDQHp07dYdbuZvHwGj0nfxBLc9qt90XsBtC\n4IYR7c/bcLMmKXYf0qoQ4OzngsnPI5M+v9QEHvYWaKVwFY4CTcSNJEwfXw+BAeO5\nOA==\n-----END CERTIFICATE-----",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDuLsggR0gJOJJN\nXH6ZrrEfE61xt3rAZbeeTGUKQnVS5Xw2Zjmi8ywacYOEkm1RDaPmKDkFwlR/e17O\noI1bi0qdI6BIhJ8QAq+mfYE+9oWrfLHZiPPSu69wYqkMxkFeYH8AC0bI39QVfOSt\nx+mmYsclNoFgYboqeZTjeA+RIPLiLDjoIkVQ66lznUAUjPtGwTuZtPWmUIzx7vmB\n+pplKfaT5abL7yfUcbJgeFUhJFW8+qRLuBUtJUR1N5pS0o/VXH/zXz8cNaTegi8N\nVYj0IUfvd6U3EGQwfnMCtI0gFN6F2d6HIB6+NjhFoL+QryuyU7d7gS0n1KcDizA6\nMKKoAhATAgMBAAECggEAd5g/3o1MK20fcP7PhsVDpHIR9faGCVNJto9vcI5cMMqP\n6xS7PgnSDFkRC6EmiLtLn8Z0k2K3YOeGfEP7lorDZVG9KoyE/doLbpK4MfBAwBG1\nj6AHpbmd5tVzQrnNmuDjBBelbDmPWVbD0EqAFI6mphXPMqD/hFJWIz1mu52Kt2s6\n++MkdqLO0ORDNhKmzu6SADQEcJ9Suhcmv8nccMmwCsIQAUrfg3qOyqU4//8QB8ZM\njosO3gMUesihVeuF5XpptFjrAliPgw9uIG0aQkhVbf/17qy0XRi8dkqXj3efxEDp\n1LSqZjBFiqJlFchbz19clwavMF/FhxHpKIhhmkkRSQKBgQD9blaWSg/2AGNhRfpX\nYq+6yKUkUD4jL7pmX1BVca6dXqILWtHl2afWeUorgv2QaK1/MJDH9Gz9Gu58hJb3\nymdeAISwPyHp8euyLIfiXSAi+ibKXkxkl1KQSweBM2oucnLsNne6Iv6QmXPpXtro\nnTMoGQDS7HVRy1on5NQLMPbUBQKBgQDwmN+um8F3CW6ZV1ZljJm7BFAgNyJ7m/5Q\nYUcOO5rFbNsHexStrx/h8jYnpdpIVlxACjh1xIyJ3lOCSAWfBWCS6KpgeO1Y484k\nEYhGjoUsKNQia8UWVt+uWnwjVSDhQjy5/pSH9xyFrUfDg8JnSlhsy0oC0C/PBjxn\nhxmADSLnNwKBgQD2A51USVMTKC9Q50BsgeU6+bmt9aNMPvHAnPf76d5q78l4IlKt\nwMs33QgOExuYirUZSgjRwknmrbUi9QckRbxwOSqVeMOwOWLm1GmYaXRf39u2CTI5\nV9gTMHJ5jnKd4gYDnaA99eiOcBhgS+9PbgKSAyuUlWwR2ciL/4uDzaVeDQKBgDym\nvRSeTRn99bSQMMZuuD5N6wkD/RxeCbEnpKrw2aZVN63eGCtkj0v9LCu4gptjseOu\n7+a4Qplqw3B/SXN5/otqPbEOKv8Shl/PT6RBv06PiFKZClkEU2T3iH27sws2EGru\nw3C3GaiVMxcVewdg1YOvh5vH8ZVlxApxIzuFlDvnAoGAN5w+gukxd5QnP/7hcLDZ\nF+vesAykJX71AuqFXB4Wh/qFY92CSm7ImexWA/L9z461+NKeJwb64Nc53z59oA10\n/3o2OcIe44kddZXQVP6KTZBd7ySVhbtOiK3/pCy+BQRsrC7d71W914DxNWadwZ+a\njtwwKjDzmPwdIXDSQarCx0U=\n-----END PRIVATE KEY-----",
  passphrase: "1234",
});

// ❯ openssl x509 -enddate -noout -in
// notAfter=Sep  5 23:27:34 2025 GMT
export const tls = Object.freeze({
  cert: "-----BEGIN CERTIFICATE-----\nMIIDrzCCApegAwIBAgIUHaenuNcUAu0tjDZGpc7fK4EX78gwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yMzA5MDYyMzI3MzRaFw0yNTA5MDUyMzI3MzRaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+7odzr3yI\nYewRNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MB\nKw3rl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwP\ndwVUeR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn\n0oH9HbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOF\nzDpcp1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FU\nIDHtnUsoHX3RAgMBAAGjTzBNMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQ\nAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUF3y/su4J/8ScpK+rM2LwTct6EQow\nDQYJKoZIhvcNAQELBQADggEBAGWGWp59Bmrk3Gt0bidFLEbvlOgGPWCT9ZrJUjgc\nhY44E+/t4gIBdoKOSwxo1tjtz7WsC2IYReLTXh1vTsgEitk0Bf4y7P40+pBwwZwK\naeIF9+PC6ZoAkXGFRoyEalaPVQDBg/DPOMRG9OH0lKfen9OGkZxmmjRLJzbyfAhU\noI/hExIjV8vehcvaJXmkfybJDYOYkN4BCNqPQHNf87ZNdFCb9Zgxwp/Ou+47J5k4\n5plQ+K7trfKXG3ABMbOJXNt1b0sH8jnpAsyHY4DLEQqxKYADbXsr3YX/yy6c0eOo\nX2bHGD1+zGsb7lGyNyoZrCZ0233glrEM4UxmvldBcWwOWfk=\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+7odzr3yIYewR\nNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MBKw3r\nl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwPdwVU\neR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn0oH9\nHbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOFzDpc\np1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FUIDHt\nnUsoHX3RAgMBAAECggEAAckMqkn+ER3c7YMsKRLc5bUE9ELe+ftUwfA6G+oXVorn\nE+uWCXGdNqI+TOZkQpurQBWn9IzTwv19QY+H740cxo0ozZVSPE4v4czIilv9XlVw\n3YCNa2uMxeqp76WMbz1xEhaFEgn6ASTVf3hxYJYKM0ljhPX8Vb8wWwlLONxr4w4X\nOnQAB5QE7i7LVRsQIpWKnGsALePeQjzhzUZDhz0UnTyGU6GfC+V+hN3RkC34A8oK\njR3/Wsjahev0Rpb+9Pbu3SgTrZTtQ+srlRrEsDG0wVqxkIk9ueSMOHlEtQ7zYZsk\nlX59Bb8LHNGQD5o+H1EDaC6OCsgzUAAJtDRZsPiZEQKBgQDs+YtVsc9RDMoC0x2y\nlVnP6IUDXt+2UXndZfJI3YS+wsfxiEkgK7G3AhjgB+C+DKEJzptVxP+212hHnXgr\n1gfW/x4g7OWBu4IxFmZ2J/Ojor+prhHJdCvD0VqnMzauzqLTe92aexiexXQGm+WW\nwRl3YZLmkft3rzs3ZPhc1G2X9QKBgQDOQq3rrxcvxSYaDZAb+6B/H7ZE4natMCiz\nLx/cWT8n+/CrJI2v3kDfdPl9yyXIOGrsqFgR3uhiUJnz+oeZFFHfYpslb8KvimHx\nKI+qcVDcprmYyXj2Lrf3fvj4pKorc+8TgOBDUpXIFhFDyM+0DmHLfq+7UqvjU9Hs\nkjER7baQ7QKBgQDTh508jU/FxWi9RL4Jnw9gaunwrEt9bxUc79dp+3J25V+c1k6Q\nDPDBr3mM4PtYKeXF30sBMKwiBf3rj0CpwI+W9ntqYIwtVbdNIfWsGtV8h9YWHG98\nJ9q5HLOS9EAnogPuS27walj7wL1k+NvjydJ1of+DGWQi3aQ6OkMIegap0QKBgBlR\nzCHLa5A8plG6an9U4z3Xubs5BZJ6//QHC+Uzu3IAFmob4Zy+Lr5/kITlpCyw6EdG\n3xDKiUJQXKW7kluzR92hMCRnVMHRvfYpoYEtydxcRxo/WS73SzQBjTSQmicdYzLE\ntkLtZ1+ZfeMRSpXy0gR198KKAnm0d2eQBqAJy0h9AoGBAM80zkd+LehBKq87Zoh7\ndtREVWslRD1C5HvFcAxYxBybcKzVpL89jIRGKB8SoZkF7edzhqvVzAMP0FFsEgCh\naClYGtO+uo+B91+5v2CCqowRJUGfbFOtCuSPR7+B3LDK8pkjK2SQ0mFPUfRA5z0z\nNVWtC0EYNBTRkqhYtqr3ZpUc\n-----END PRIVATE KEY-----\n",
});

export const invalidTls = Object.freeze({
  cert: "-----BEGIN CERTIFICATE-----\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yNTAyMDQwNDUyNTdaFw0yNzAyMDQwNDUyNTdaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC1rZqCnASs\nHPzPjs/mls+z3qTl6OsCNI+kTsA23/+ZkvtBe7EI+9LfV1Sy4MF66ZovR0UgeJUB\nlL7ExadXkfZJS0N6LEAIyEMQI0cpILv3i6sJCcRwHV7X7N55lkUdsJtQ3fSKsyn9\nPDWJGVdwtRjdod3XyevYcx5NLGZOF/4KJmR4eNkX8ycG8zvW/srPHHE95/+k/5Wo\n/RrS+OLl+bgVznxmXtnFMdbYvJ1RLyipCED2P569NWXAgCzYESX2tqLr20R8ca8Q\niTcXXijY1Wq+pVR5NhIckt+zyZlUQ5IT3DvAQn4aW30wA514k1AKDKQjtxdRzVmV\nGDOTOzAlpmeZAgMBAAGjTzBNMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQ\nAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUkgeZUw9BZc/9mxAym4BjaVYhHoow\nDQYJKoZIhvcNAQELBQADggEBAJGQomt68rO1wuhHaG355kGaIsTsoUJgs7VAKNI2\n0/vtMKODX2Zo2BHhiI1wSH751IySqWbGYCvXl6QrsV5tD/jdIYKvyXLFmV0KgQSY\nkZ91sde4jIiiqL5h03GJSUydCl4SE1A1H8Ht41NYoyVaWVPzv5lprt654vpRPbPq\nYBQTWSFcYkmGnza/tRALUftM5U3yKOTQ8sKH/eKGC9KU0DI5pZ2XAxrIyvrJZMm1\n0WwWTrO0KlXN8N9v8tVCVm7g6mYug4HEADQ4kymyfwM6mPY1EmsGy36KOqCRUtUR\n+jmAZr9m+l+27GxR9zjxoLWHkARuWZM/hL//u90cNfNDRgQ=\n-----END CERTIFICATE-----\n",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC1rZqCnASsHPzP\njs/mls+z3qTl6OsCNI+kTsA23/+ZkvtBe7EI+9LfV1Sy4MF66ZovR0UgeJUBlL7E\nxadXkfZJS0N6LEAIyEMQI0cpILv3i6sJCcRwHV7X7N55lkUdsJtQ3fSKsyn9PDWJ\nGVdwtRjdod3XyevYcx5NLGZOF/4KJmR4eNkX8ycG8zvW/srPHHE95/+k/5Wo/RrS\n+OLl+bgVznxmXtnFMdbYvJ1RLyipCED2P569NWXAgCzYESX2tqLr20R8ca8QiTcX\nXijY1Wq+pVR5NhIckt+zyZlUQ5IT3DvAQn4aW30wA514k1AKDKQjtxdRzVmVGDOT\nOzAlpmeZAgMBAAECggEANW6F2zTckOwDlF2pmmUvV/S6pZ1/hIoF1uqMUHdHmpim\nSaeBtSUu6x2pnORKMwaCILaCx55/IFRpWMDSywf0GbFHeqaJ/Ks9QgFGG/vzHEZY\n+pMDUX/p1XJmKfc+g5Fd1IY6thIkXsR28EfiNhUk54YEE0NhGCsfNc5BlmUrAzuw\nSevCkbChsZzLoasskt5hgWOb1wT757xDrOOss3LXvwaFkMXANQHiaGWxSpmyXTVf\nmtIX4wpN2K5BQxRBV6xmRaBBp7fWJlbqvV67wwh2cxIAyvQ68VVVHTbfv44TUw62\nyCKle6hSLi/OnMr1FJv16Ez+K3lUIkYE0nTYIvQkYwKBgQD34Nwy0U8WcHcOSbU1\nMIREfvPNYfl/hH94wmLyKZWhpqOfqgrUg+19+n9TXw4DGdO7lwAzz+ud7TImbGDI\n+1cb9/FxTK5cRwICTLC+Pse6pVkKUvPdil/TfHZBJP1jeIMGMDVi0fcGv97LxrHV\nJGQwA5x1nHGHl0JrENRqm3M2NwKBgQC7oXkWb0s2C8ANI14gz+q/2EmTSJxxrzXR\nz5EQk87PmPfkY4I1T8vKFcaiJynyReLwpYTip2WYGqc7qAO9oLwmA+d/NMOBI2sg\noEn154Q9zvr3jqIgu9/AapEgEDlA+v18veoIz3bae6wu57lpGvGtCoQLBS6q2UZg\n3zFI3BJorwKBgDz4WjFFuqZSU3Z4OtIydNZEQ8Oo7a2n8ZLKfXwDLoLsciK7uJ49\nNRVfoCHpp5CrsaDaq3oTEmluBn/c+JF3AR4oBoNP0TNxY9Uc9/xThN0r/pLDhKhh\neOCUJKIxbwIgilnjUb5U1uYaG7sTzHoY0Wvd94YWTPaFBhk/sn/mbJhRAoGAA+/E\nWZsmKdEfS2dFj0ytcS75hDSOy7fQWkGPmphvS127Pbh0v+eXr/q6+yX1NFcRBtmC\nKzs133YXsiG5Sl439Fg6oCmcPHZgxgN26cjctmtESrNcZXFrpV7XAqQ0f0+Ex/w4\nD81Cghz8JNPJyRG+plHFKXIHY6BBYMDuCMhNPpMCgYEA1BVG5scNtmBE3SaRns2G\npKgWiwmzPDTqwf3R0rgkHQroZUIz616jLgKXIVMBPaq/771uq+hzJZro9sNcNL8p\n9PkLRr4V4KtUSqkjvitU68vMM1qxtO9NVwCI5u3wicVC5mMqcH8FN+sO/5/jIPBl\nO/qEOVDlCuYtURcnh/Oz1cE=\n-----END PRIVATE KEY-----\n",
});

export function disableAggressiveGCScope() {
  const gc = Bun.unsafe.gcAggressionLevel(0);
  return {
    [Symbol.dispose]() {
      Bun.unsafe.gcAggressionLevel(gc);
    },
  };
}

String.prototype.isLatin1 = function () {
  return require("bun:internal-for-testing").jscInternals.isLatin1String(this);
};

String.prototype.isUTF16 = function () {
  return require("bun:internal-for-testing").jscInternals.isUTF16String(this);
};

interface BunHarnessTestMatchers {
  toBeLatin1String(): void;
  toBeUTF16String(): void;
  toHaveTestTimedOutAfter(expected: number): void;
  toBeBinaryType(expected: keyof typeof binaryTypes): void;
  toRun(optionalStdout?: string, expectedCode?: number): void;
  toThrowWithCode(cls: CallableFunction, code: string): void;
  toThrowWithCodeAsync(cls: CallableFunction, code: string): Promise<void>;
}

declare module "bun:test" {
  interface Matchers<T> extends BunHarnessTestMatchers {}
  interface AsymmetricMatchers extends BunHarnessTestMatchers {}
}

/**
 * Set `NODE_TLS_REJECT_UNAUTHORIZED` for a scope.
 */
export function rejectUnauthorizedScope(value: boolean) {
  const original_rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = value ? "1" : "0";
  return {
    [Symbol.dispose]() {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = original_rejectUnauthorized;
    },
  };
}

let networkInterfaces: any;

function isIP(type: "IPv4" | "IPv6") {
  if (!networkInterfaces) {
    networkInterfaces = os.networkInterfaces();
  }
  for (const networkInterface of Object.values(networkInterfaces)) {
    for (const { family } of networkInterface as any[]) {
      if (family === type) {
        return true;
      }
    }
  }
  return false;
}

export function isIPv6() {
  // FIXME: AWS instances on Linux for Buildkite are not setup with IPv6
  if (isBuildKite && isLinux) {
    return false;
  }
  return isIP("IPv6");
}

export function isIPv4() {
  return isIP("IPv4");
}

let glibcVersion: string | undefined;

export function getGlibcVersion() {
  if (glibcVersion || !isLinux) {
    return glibcVersion;
  }
  try {
    const { header } = process.report!.getReport() as any;
    const { glibcVersionRuntime: version } = header;
    if (typeof version === "string") {
      return (glibcVersion = version);
    }
  } catch (error) {
    console.warn("Failed to detect glibc version", error);
  }
}

export function isGlibcVersionAtLeast(version: string): boolean {
  const glibcVersion = getGlibcVersion();
  if (!glibcVersion) {
    return false;
  }
  return Bun.semver.satisfies(glibcVersion, `>=${version}`);
}

let macOSVersion: string | undefined;

export function getMacOSVersion(): string | undefined {
  if (macOSVersion || !isMacOS) {
    return macOSVersion;
  }
  try {
    const { stdout } = Bun.spawnSync({
      cmd: ["sw_vers", "-productVersion"],
    });
    return (macOSVersion = stdout.toString().trim());
  } catch (error) {
    console.warn("Failed to detect macOS version:", error);
  }
}

export function isMacOSVersionAtLeast(minVersion: number): boolean {
  const macOSVersion = getMacOSVersion();
  if (!macOSVersion) {
    return false;
  }
  return parseFloat(macOSVersion) >= minVersion;
}

export function readableStreamFromArray(array) {
  return new ReadableStream({
    pull(controller) {
      for (let entry of array) {
        controller.enqueue(entry);
      }
      controller.close();
    },
  });
}

let hasGuardMalloc = -1;
export function forceGuardMalloc(env) {
  if (process.platform !== "darwin") {
    return;
  }

  if (hasGuardMalloc === -1) {
    hasGuardMalloc = Number(fs.existsSync("/usr/lib/libgmalloc.dylib"));
  }

  if (hasGuardMalloc === 1) {
    env.DYLD_INSERT_LIBRARIES = "/usr/lib/libgmalloc.dylib";
    env.MALLOC_PROTECT_BEFORE = "1";
    env.MallocScribble = "1";
    env.MallocGuardEdges = "1";
    env.MALLOC_FILL_SPACE = "1";
    env.MALLOC_STRICT_SIZE = "1";
  } else {
    console.warn("Guard malloc is not available on this platform for some reason.");
  }
}

export function fileDescriptorLeakChecker() {
  const initial = getMaxFD();
  return {
    [Symbol.dispose]() {
      const current = getMaxFD();
      if (current > initial) {
        throw new Error(`File descriptor leak detected: ${current} (current) > ${initial} (initial)`);
      }
    },
  };
}

/**
 * Gets a secret from the environment.
 *
 * In Buildkite, secrets must be retrieved using the `buildkite-agent secret get` command
 * and are not available as an environment variable.
 */
export function getSecret(name: string): string | undefined {
  let value = process.env[name]?.trim();

  // When not running in CI, allow the secret to be missing.
  if (!isCI) {
    return value;
  }

  // In Buildkite, secrets must be retrieved using the `buildkite-agent secret get` command
  if (!value && isBuildKite) {
    const { exitCode, stdout } = spawnSync({
      cmd: ["buildkite-agent", "secret", "get", name],
      stdout: "pipe",
      env: ciEnv,
      stderr: "inherit",
    });
    if (exitCode === 0) {
      value = stdout.toString().trim();
    }
  }

  // Throw an error if the secret is not found, so the test fails in CI.
  if (!value) {
    let hint;
    if (isBuildKite) {
      hint = `Create a secret with the name "${name}" in the Buildkite UI.
https://buildkite.com/docs/pipelines/security/secrets/buildkite-secrets`;
    } else {
      hint = `Define an environment variable with the name "${name}".`;
    }

    throw new Error(`Secret not found: ${name}\n${hint}`);
  }

  // Set the secret in the environment so that it can be used in tests.
  process.env[name] = value;

  return value;
}

export function assertManifestsPopulated(absCachePath: string, registryUrl: string) {
  const { npm_manifest_test_helpers } = require("bun:internal-for-testing");
  const { parseManifest } = npm_manifest_test_helpers;

  for (const file of fs.readdirSync(absCachePath)) {
    if (!file.endsWith(".npm")) continue;

    const manifest = parseManifest(join(absCachePath, file), registryUrl);
    expect(manifest.versions.length).toBeGreaterThan(0);
  }
}

// Make it easier to run some node tests.
Object.defineProperty(globalThis, "gc", {
  value: Bun.gc,
  writable: true,
  enumerable: false,
  configurable: true,
});

export function waitForFileToExist(path: string, interval_ms: number) {
  while (!fs.existsSync(path)) {
    sleepSync(interval_ms);
  }
}

export function libcPathForDlopen() {
  switch (process.platform) {
    case "linux":
      switch (libcFamily) {
        case "glibc":
          return "libc.so.6";
        case "musl":
          return "/usr/lib/libc.so";
      }
    case "darwin":
      return "libc.dylib";
    default:
      throw new Error("TODO");
  }
}

export function cwdScope(cwd: string) {
  const original = process.cwd();
  process.chdir(cwd);
  return {
    [Symbol.dispose]() {
      process.chdir(original);
    },
  };
}

export function rmScope(path: string) {
  return {
    [Symbol.dispose]() {
      fs.rmSync(path, { recursive: true, force: true });
    },
  };
}

export function textLockfile(version: number, pkgs: any): string {
  return JSON.stringify({
    lockfileVersion: version,
    ...pkgs,
  });
}

export class VerdaccioRegistry {
  port: number;
  process: ChildProcess | undefined;
  configPath: string;
  packagesPath: string;
  users: Record<string, string> = {};

  constructor(opts?: { configPath?: string; packagesPath?: string; verbose?: boolean }) {
    this.port = randomPort();
    this.configPath = opts?.configPath ?? join(import.meta.dir, "cli", "install", "registry", "verdaccio.yaml");
    this.packagesPath = opts?.packagesPath ?? join(import.meta.dir, "cli", "install", "registry", "packages");
  }

  async start(silent: boolean = true) {
    await rm(join(dirname(this.configPath), "htpasswd"), { force: true });
    this.process = fork(require.resolve("verdaccio/bin/verdaccio"), ["-c", this.configPath, "-l", `${this.port}`], {
      silent,
      // Prefer using a release build of Bun since it's faster
      execPath: isCI ? bunExe() : Bun.which("bun") || bunExe(),
    });

    this.process.stderr?.on("data", data => {
      console.error(`[verdaccio] stderr: ${data}`);
    });

    const started = Promise.withResolvers();

    this.process.on("error", error => {
      console.error(`Failed to start verdaccio: ${error}`);
      started.reject(error);
    });

    this.process.on("exit", (code, signal) => {
      if (code !== 0) {
        console.error(`Verdaccio exited with code ${code} and signal ${signal}`);
      } else {
        console.log("Verdaccio exited successfully");
      }
    });

    this.process.on("message", (message: { verdaccio_started: boolean }) => {
      if (message.verdaccio_started) {
        started.resolve();
      }
    });

    await started.promise;
  }

  registryUrl() {
    return `http://localhost:${this.port}/`;
  }

  stop() {
    rmSync(join(dirname(this.configPath), "htpasswd"), { force: true });
    this.process?.kill(0);
  }

  /**
   * returns auth token
   */
  async generateUser(username: string, password: string): Promise<string> {
    if (this.users[username]) {
      throw new Error(`User ${username} already exists`);
    } else this.users[username] = password;

    const url = `http://localhost:${this.port}/-/user/org.couchdb.user:${username}`;
    const user = {
      name: username,
      password: password,
      email: `${username}@example.com`,
    };

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(user),
    });

    if (response.ok) {
      const data = await response.json();
      return data.token;
    }

    throw new Error("Failed to create user:", response.statusText);
  }

  async authBunfig(user: string) {
    const authToken = await this.generateUser(user, user);
    return `
        [install]
        cache = false
        registry = { url = "http://localhost:${this.port}/", token = "${authToken}" }
        `;
  }

  async createTestDir(bunfigOpts: BunfigOpts = {}) {
    await rm(join(dirname(this.configPath), "htpasswd"), { force: true });
    await rm(join(this.packagesPath, "private-pkg-dont-touch"), { force: true });
    const packageDir = tmpdirSync();
    const packageJson = join(packageDir, "package.json");
    await this.writeBunfig(packageDir, bunfigOpts);
    this.users = {};
    return { packageDir, packageJson };
  }

  async writeBunfig(dir: string, opts: BunfigOpts = {}) {
    let bunfig = `
    [install]
    cache = "${join(dir, ".bun-cache")}"
    `;
    if ("saveTextLockfile" in opts) {
      bunfig += `saveTextLockfile = ${opts.saveTextLockfile}
      `;
    }
    if (!opts.npm) {
      bunfig += `registry = "${this.registryUrl()}"`;
    }
    await write(join(dir, "bunfig.toml"), bunfig);
  }
}

type BunfigOpts = {
  saveTextLockfile?: boolean;
  npm?: boolean;
};

export async function readdirSorted(path: string): Promise<string[]> {
  const results = await readdir(path);
  results.sort();
  return results;
}
