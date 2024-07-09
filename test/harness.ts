import { gc as bunGC, unsafe, which } from "bun";
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { readlink, readFile, writeFile } from "fs/promises";
import { isAbsolute, join, dirname } from "path";
import fs, { openSync, closeSync } from "node:fs";
import os from "node:os";
import { heapStats } from "bun:jsc";

type Awaitable<T> = T | Promise<T>;

export const BREAKING_CHANGES_BUN_1_2 = false;

export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isPosix = isMacOS || isLinux;
export const isWindows = process.platform === "win32";
export const isIntelMacOS = isMacOS && process.arch === "x64";
export const isDebug = Bun.version.includes("debug");
export const isCI = process.env.CI !== undefined;
export const isBuildKite = process.env.BUILDKITE === "true";

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
};

if (isWindows) {
  bunEnv.SHELLOPTS = "igncr"; // Ignore carriage return
}

for (let key in bunEnv) {
  if (bunEnv[key] === undefined) {
    delete bunEnv[key];
  }

  if (key.startsWith("BUN_DEBUG_") && key !== "BUN_DEBUG_QUIET_LOGS") {
    delete bunEnv[key];
  }
}

delete bunEnv.NODE_ENV;

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
  expect(heapStats().objectTypeCounts[type]).toBeLessThanOrEqual(count);
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

type DirectoryTree = {
  [name: string]:
    | string
    | Buffer
    | DirectoryTree
    | ((opts: { root: string }) => Awaitable<string | Buffer | DirectoryTree>);
};

export function tempDirWithFiles(basename: string, files: DirectoryTree): string {
  async function makeTree(base: string, tree: DirectoryTree) {
    for (const [name, raw_contents] of Object.entries(tree)) {
      const contents = typeof raw_contents === "function" ? await raw_contents({ root: base }) : raw_contents;
      const joined = join(base, name);
      if (name.includes("/")) {
        const dir = dirname(name);
        fs.mkdirSync(join(base, dir), { recursive: true });
      }
      if (typeof contents === "object" && contents && !Buffer.isBuffer(contents)) {
        fs.mkdirSync(joined);
        makeTree(joined, contents);
        continue;
      }
      fs.writeFileSync(joined, contents);
    }
  }
  const base = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), basename + "_"));
  makeTree(base, files);
  return base;
}

export function bunRun(file: string, env?: Record<string, string>) {
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
  "float32array": Float32Array,
  "float64array": Float64Array,
} as const;

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
  toRun(cmds: string[], optionalStdout?: string) {
    const result = Bun.spawnSync({
      cmd: [bunExe(), ...cmds],
      env: bunEnv,
      stdio: ["inherit", "pipe", "inherit"],
    });

    if (result.exitCode !== 0) {
      return {
        pass: false,
        message: () => `Command ${cmds.join(" ")} failed:` + "\n" + result.stdout.toString("utf-8"),
      };
    }

    if (optionalStdout) {
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

export function tmpdirSync(pattern: string = "bun.test.") {
  return fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), pattern));
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
  },
) {
  const production = options?.production ?? false;
  const args = production ? [bunExe(), "install", "--production"] : [bunExe(), "install"];
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
  let err = (await new Response(stderr).text()).replace(/warn: Slow filesystem/g, "");
  expect(err).not.toContain("panic:");
  if (!options?.allowErrors) {
    expect(err).not.toContain("error:");
  }
  if (!options?.allowWarnings) {
    expect(err).not.toContain("warn:");
  }
  if ((options?.savesLockfile ?? true) && !production) {
    expect(err).toContain("Saved lockfile");
  }
  let out = await new Response(stdout).text();
  expect(await exited).toBe(options?.expectedExitCode ?? 0);
  return { out, err, exited };
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

expect.extend({
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

interface BunHarnessTestMatchers {
  toBeLatin1String(): void;
  toBeUTF16String(): void;
  toHaveTestTimedOutAfter(expected: number): void;
  toBeBinaryType(expected: keyof typeof binaryTypes): void;
  toRun(optionalStdout?: string): void;
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
