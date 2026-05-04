import { describe, expect, it } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isWindows } from "harness";
import * as os from "node:os";

it("arch", () => {
  expect(["x64", "x86", "arm64"].some(arch => os.arch() === arch)).toBe(true);
});

it("endianness", () => {
  expect(/[BL]E/.test(os.endianness())).toBe(true);
});

it("freemem", () => {
  expect(os.freemem()).toBeGreaterThan(1024 * 1024);
});

it("totalmem", () => {
  expect(os.totalmem()).toBeGreaterThan(1024 * 1024);
});

it("getPriority", () => {
  var prio = os.getPriority();
  expect(-20 <= prio && prio <= 20).toBe(true);
  prio = os.getPriority(0);
  expect(-20 <= prio && prio <= 20).toBe(true);
});

it("setPriority", () => {
  if (isWindows) {
    expect(os.setPriority(0, 10)).toBe(undefined);
    expect(os.getPriority()).toBe(10);
    expect(os.setPriority(0)).toBe(undefined);
    expect(os.getPriority()).toBe(0);
  } else {
    expect(os.setPriority(0, 2)).toBe(undefined);
    expect(os.getPriority()).toBe(2);
    expect(os.setPriority(5)).toBe(undefined);
    expect(os.getPriority()).toBe(5);
  }
});

it("loadavg", () => {
  if (isWindows) {
    expect(os.loadavg()).toEqual([0, 0, 0]);
  } else {
    const out = Bun.spawnSync(["uptime"]).stdout.toString();
    const regex = /load averages?: ([\d\.]+),? ([\d\.]+),? ([\d\.]+)/;
    const result = regex.exec(out);
    const expected = [parseFloat(result[1]), parseFloat(result[2]), parseFloat(result[3])];
    const actual = os.loadavg();
    expect(actual).toBeArrayOfSize(3);
    for (let i = 0; i < 3; i++) {
      // This is quite a lenient range, just in case the load average is changing rapidly
      expect(actual[i]).toBeWithin(expected[i] / 2 - 0.5, expected[i] * 2 + 0.5);
    }
  }
});

it("homedir", () => {
  expect(os.homedir() !== "unknown").toBe(true);
});

it("tmpdir", () => {
  if (isWindows) {
    expect(
      [
        process.env.TEMP,
        `${process.env.SystemRoot || process.env.windir}\\Temp`,
        `${process.env.LOCALAPPDATA}\\Temp`,
      ].includes(os.tmpdir()),
    ).toBeTrue();
  } else {
    const originalEnv = process.env.TMPDIR;
    let dir = process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
    if (dir.length > 1 && dir.endsWith("/")) {
      dir = dir.substring(0, dir.length - 1);
    }
    expect(realpathSync(os.tmpdir())).toBe(realpathSync(dir));

    process.env.TMPDIR = "/boop";
    expect(os.tmpdir()).toBe("/boop");
    process.env.TMPDIR = originalEnv;
  }
});

it("hostname", () => {
  expect(os.hostname() !== "unknown").toBe(true);
});

it("platform", () => {
  expect(["win32", "darwin", "linux", "wasm"].some(platform => os.platform() === platform)).toBe(true);
});

it("release", () => {
  expect(os.release().length > 1).toBe(true);
});

it("type", () => {
  expect(["Windows_NT", "Darwin", "Linux"].some(type => os.type() === type)).toBe(true);
});

it("uptime", () => {
  expect(os.uptime() > 0).toBe(true);
});

it("version", () => {
  expect(typeof os.version() === "string").toBe(true);
  if (isWindows) {
    expect(os.version()).toInclude("Win");
    console.log(os.version());
  }
});

it("userInfo", () => {
  const info = os.userInfo();

  if (process.platform !== "win32") {
    expect(info.username).toBe(process.env.USER);
    expect(info.shell).toBe(process.env.SHELL || "unknown");
    expect(info.uid >= 0).toBe(true);
    expect(info.gid >= 0).toBe(true);
  } else {
    expect(info.username).toBe(process.env.USERNAME);
    expect(info.shell).toBe(null);
    expect(info.uid).toBe(-1);
    expect(info.gid).toBe(-1);
  }
});

it("cpus", () => {
  const cpus = os.cpus();

  for (const cpu of cpus) {
    expect(typeof cpu.model === "string").toBe(true);
    expect(typeof cpu.speed === "number").toBe(true);
    expect(typeof cpu.times.idle === "number").toBe(true);
    expect(typeof cpu.times.irq === "number").toBe(true);
    expect(typeof cpu.times.nice === "number").toBe(true);
    expect(typeof cpu.times.sys === "number").toBe(true);
    expect(typeof cpu.times.user === "number").toBe(true);
  }
});

it("networkInterfaces", () => {
  const networkInterfaces = os.networkInterfaces();

  for (const networkInterface of Object.values(networkInterfaces)) {
    for (const nI of networkInterface) {
      expect(typeof nI.address === "string").toBe(true);
      expect(typeof nI.netmask === "string").toBe(true);
      expect(typeof nI.family === "string").toBe(true);
      expect(typeof nI.mac === "string").toBe(true);
      expect(typeof nI.internal === "boolean").toBe(true);
      if (nI.cidr)
        // may be null
        expect(typeof nI.cidr).toBe("string");

      if (nI.family === "IPv6") {
        expect(nI.scopeid).toBeNumber();
        expect(nI.scope_id).toBeUndefined();
      }
    }
  }
});

it("machine", () => {
  const possibleValues = [
    "arm",
    "arm64",
    "aarch64",
    "mips",
    "mips64",
    "ppc64",
    "ppc64le",
    "s390",
    "s390x",
    "i386",
    "i686",
    "x86_64",
  ];
  expect(possibleValues.includes(os.machine())).toBe(true);
});

it("EOL", () => {
  if (isWindows) expect(os.EOL).toBe("\r\n");
  else expect(os.EOL).toBe("\n");
});

it("devNull", () => {
  if (isWindows) expect(os.devNull).toBe("\\\\.\\nul");
  else expect(os.devNull).toBe("/dev/null");
});

it("availableParallelism", () => {
  expect(os.availableParallelism()).toBeGreaterThan(0);
});

it("loadavg", () => {
  const loadavg = os.loadavg();
  expect(loadavg.length).toBe(3);
  expect(loadavg.every(avg => typeof avg === "number")).toBeTrue();
});

// https://github.com/oven-sh/bun/issues/10259
describe("toString works like node", () => {
  const exportsWithStrings = [
    "arch",
    "availableParallelism",
    "endianness",
    "freemem",
    "homedir",
    "hostname",
    "platform",
    "release",
    "tmpdir",
    "totalmem",
    "type",
    "uptime",
    "version",
    "machine",
  ];
  for (const key of exportsWithStrings) {
    // node implements Symbol.toPrimitive, not toString!
    it(`${key}.toString()`, () => {
      expect(os[key].toString()).toStartWith("function");
    });

    it(`${key} + ''`, () => {
      const left = os[key] + "";
      const right = os[key]() + "";
      if (left !== right) {
        // uptime, totalmem, and a few others might differ slightly on each call
        // we just want to check we're not getting NaN, Infinity, or -Infinity
        expect(Number.isFinite(Math.trunc(parseFloat(left)))).toBeTrue();
        expect(Number.isFinite(Math.trunc(parseFloat(right)))).toBeTrue();
      } else {
        expect(left).toBe(right);
      }
    });
  }
});

it("getPriority system error object", () => {
  try {
    os.getPriority(-1);
    expect.unreachable();
  } catch (err) {
    expect(err.name).toBe("SystemError");
    expect(err.message).toBe("A system error occurred: uv_os_getpriority returned ESRCH (no such process)");
    expect(err.code).toBe("ERR_SYSTEM_ERROR");
    expect(err.info).toEqual({
      errno: isWindows ? -4040 : -3,
      code: "ESRCH",
      message: "no such process",
      syscall: "uv_os_getpriority",
    });
    expect(err.errno).toBe(isWindows ? -4040 : -3);
    expect(err.syscall).toBe("uv_os_getpriority");
  }
});

// https://github.com/oven-sh/bun/issues/29244
//
// os.homedir() returned a stale value after process.env.HOME was mutated at
// runtime because the Zig binding read HOME via Bun's snapshot-on-first-read
// env-var cache. Node's posix uv_os_homedir checks HOME live on every call:
// it returns getenv("HOME") verbatim whenever it's non-NULL (so HOME="" → ""),
// and only falls back to the passwd entry when HOME is unset.
// os.userInfo().homedir reads passwd directly and does NOT honor HOME — that
// behavior must be preserved.
//
// Each test spawns its own subprocess so mutating process.env.HOME can't
// bleed into the test runner — so they run concurrently.
describe("homedir live $HOME mutations (#29244)", () => {
  async function runBun(source, extraEnv = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: { ...bunEnv, ...extraEnv },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }

  it.concurrent.skipIf(isWindows)("reflects HOME mutation after require", async () => {
    const { stdout, exitCode } = await runBun(`
      const os = require('node:os');
      const before = os.homedir();
      process.env.HOME = '/tmp/test-home-29244';
      const after = os.homedir();
      console.log(JSON.stringify({ before, after, env: process.env.HOME }));
    `);
    const result = JSON.parse(stdout);
    expect(result.after).toBe("/tmp/test-home-29244");
    expect(result.env).toBe("/tmp/test-home-29244");
    // Baseline came from the inherited HOME — non-empty, not the mutated value.
    expect(typeof result.before).toBe("string");
    expect(result.before.length).toBeGreaterThan(0);
    expect(result.before).not.toBe("/tmp/test-home-29244");
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("reflects HOME mutation before require", async () => {
    const { stdout, exitCode } = await runBun(`
      process.env.HOME = '/tmp/before-require-29244';
      const os = require('node:os');
      console.log(JSON.stringify({ homedir: os.homedir(), env: process.env.HOME }));
    `);
    expect(JSON.parse(stdout)).toEqual({
      homedir: "/tmp/before-require-29244",
      env: "/tmp/before-require-29244",
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("honors HOME from parent env", async () => {
    const { stdout, exitCode } = await runBun(`console.log(require('node:os').homedir());`, {
      HOME: "/tmp/inherited-29244",
    });
    expect(stdout.trim()).toBe("/tmp/inherited-29244");
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("returns '' when HOME is set to empty string", async () => {
    // Match Node / libuv: uv_os_homedir returns whatever getenv("HOME") gives
    // when non-NULL, including "". Only an absent HOME falls through to the
    // passwd entry. Previously Bun treated "" as unset — divergent and now
    // fixed.
    const { stdout, exitCode } = await runBun(`
      process.env.HOME = '';
      console.log(JSON.stringify(require('node:os').homedir()));
    `);
    expect(JSON.parse(stdout)).toBe("");
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("falls back to passwd when HOME is deleted", async () => {
    // Deleted HOME (getenv returns NULL) is the one case that should fall
    // through to the passwd entry, matching libuv's UV_ENOENT branch.
    //
    // Seed HOME with a sentinel value the passwd entry cannot possibly be,
    // then delete it. If the delete were silently ignored (the regression
    // class #29244 targets), homedir() would still return the sentinel. We
    // also cross-check against os.userInfo().homedir — the passwd entry —
    // to prove the passwd path was actually taken.
    const sentinel = "/tmp/sentinel-deleted-29244";
    const { stdout, exitCode } = await runBun(
      `
        delete process.env.HOME;
        const os = require('node:os');
        console.log(JSON.stringify({ h: os.homedir(), passwd: os.userInfo().homedir }));
      `,
      { HOME: sentinel },
    );
    const result = JSON.parse(stdout);
    expect(result.h).not.toBe(sentinel); // delete was honored
    expect(result.h).toBe(result.passwd); // same source as userInfo
    expect(result.h.length).toBeGreaterThan(0);
    expect(result.h.startsWith("/")).toBe(true);
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(isWindows)("userInfo().homedir ignores HOME mutation", async () => {
    // Node's os.userInfo().homedir reads the passwd entry, NOT $HOME.
    // The fix for os.homedir() must NOT leak into userInfo.
    const { stdout, exitCode } = await runBun(`
      process.env.HOME = '/tmp/should-not-appear-29244';
      const os = require('node:os');
      const passwd = os.userInfo().homedir;
      console.log(JSON.stringify({ passwd, leaked: passwd === '/tmp/should-not-appear-29244' }));
    `);
    const result = JSON.parse(stdout);
    expect(result.leaked).toBe(false);
    expect(typeof result.passwd).toBe("string");
    expect(result.passwd.length).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });
});
