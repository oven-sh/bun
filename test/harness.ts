import { gc as bunGC, unsafe, which } from "bun";
import { expect } from "bun:test";
import { platform } from "os";

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
  if (process.platform === "win32") {
    return path.replace(/\//g, "\\");
  }
  return path;
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
