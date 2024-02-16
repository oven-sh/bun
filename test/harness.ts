import { gc as bunGC, unsafe, which } from "bun";
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { readlink, readFile } from "fs/promises";
import { isAbsolute } from "path";
import { openSync, closeSync } from "node:fs";

export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isPosix = isMacOS || isLinux;
export const isWindows = process.platform === "win32";
export const isIntelMacOS = isMacOS && process.arch === "x64";

export const bunEnv: NodeJS.ProcessEnv = {
  ...process.env,
  GITHUB_ACTIONS: "false",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  TZ: "Etc/UTC",
  CI: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
};

export function bunExe() {
  return process.execPath;
}

export function nodeExe(): string | null {
  return which("node") || null;
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

export function tempDirWithFiles(basename: string, files: Record<string, string | Record<string, string>>): string {
  var fs = require("fs");
  var path = require("path");
  var { tmpdir } = require("os");

  const dir = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), basename + "_"));
  for (const [name, contents] of Object.entries(files)) {
    if (typeof contents === "object") {
      const entries = Object.entries(contents);
      if (entries.length == 0) {
        fs.mkdirSync(path.join(dir, name), { recursive: true });
      } else {
        for (const [_name, _contents] of entries) {
          fs.mkdirSync(path.dirname(path.join(dir, name, _name)), { recursive: true });
          fs.writeFileSync(path.join(dir, name, _name), _contents);
        }
      }
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
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

export function bunRunAsScript(dir: string, script: string, env?: Record<string, string>) {
  const result = Bun.spawnSync([bunExe(), `run`, `${script}`], {
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
  return 1024 + Math.floor(Math.random() * 65535);
}

expect.extend({
  toRun(cmds: string[]) {
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
  if (isWindows) {
    return 0;
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
