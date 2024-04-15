import { gc as bunGC, unsafe, which } from "bun";
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { readlink, readFile, writeFile } from "fs/promises";
import { isAbsolute, sep, join, dirname } from "path";
import fs, { openSync, closeSync } from "node:fs";
import os from "node:os";

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

export function bunExe() {
  if (isWindows) return process.execPath.replaceAll("\\", "/");
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

type DirectoryTree = {
  [name: string]: string | Buffer | DirectoryTree;
};

export function tempDirWithFiles(basename: string, files: DirectoryTree): string {
  function makeTree(base: string, tree: DirectoryTree) {
    for (const [name, contents] of Object.entries(tree)) {
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

/**
 * Ignore mimalloc warnings in development
 */
export function ignoreMimallocWarning({
  beforeAll,
  afterAll,
}: Pick<typeof import("bun:test"), "beforeAll"> & Pick<typeof import("bun:test"), "afterAll">) {
  const origResponseText = Response.prototype.text;
  beforeAll(() => {
    // @ts-expect-error
    Response.prototype.text = async function () {
      return withoutMimalloc(await origResponseText.call(this));
    };
  });

  afterAll(() => {
    // @ts-expect-error
    Response.prototype.text = origResponseText;
  });
}

export function hasIP(v: "IPv4" | "IPv6"): boolean {
  const { networkInterfaces } = require("node:os");
  for (const addresses of Object.values(networkInterfaces())) {
    for (const { family } of addresses as any[]) {
      if (family === v) return true;
    }
  }
  return false;
}

export function randomPort(): number {
  return Math.floor(Math.random() * (65535 - 1024) + 1024);
}
