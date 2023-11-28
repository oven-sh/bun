import { gc as bunGC, unsafe, which } from "bun";

export const bunEnv: any = {
  ...process.env,
  GITHUB_ACTIONS: "false",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  TZ: "Etc/UTC",
  CI: "1",
};

export function bunExe() {
  return process.execPath;
}

export function withoutMimalloc(input: string) {
  return input.replaceAll(/^mimalloc warning:.*$/gm, "");
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
      for (const [_name, _contents] of Object.entries(contents)) {
        fs.mkdirSync(path.dirname(path.join(dir, name, _name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name, _name), _contents);
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
