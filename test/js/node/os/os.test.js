import { describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
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

// https://github.com/oven-sh/bun/issues/29689
//
// On Linux, cpusImplLinux used the `processor:` field from /proc/cpuinfo
// directly as an array index, and iterated 0..num_cpus for sysfs. Dual-
// socket EPYCs expose /proc/stat and /proc/cpuinfo with sparse IDs —
// e.g. cpu0..cpu63, cpu128..cpu191 — so `processor: 128` tripped the
// `cpu_index >= num_cpus` guard and os.cpus() threw ERR_SYSTEM_ERROR.
//
// Fix: parse the real CPU ID from each `cpuN` line, keep a
// cpu_id->array_index map, and use that map in the /proc/cpuinfo and
// sysfs passes. Exercise via BUN_DEBUG_CPUS_PROCFS_ROOT which redirects
// procfs/sysfs reads to a staged tempdir.
it.skipIf(!isLinux)("cpus() handles non-contiguous CPU IDs (#29689)", async () => {
  // Simulated 8-CPU EPYC-style layout: IDs 0..3 then 8..11. The crash
  // reproduces with any ID >= total CPU count; 8 with count 8 is enough.
  const cpuIds = [0, 1, 2, 3, 8, 9, 10, 11];

  const statBody =
    "cpu  100 0 100 1000 0 0 0 0 0 0\n" +
    cpuIds.map(id => `cpu${id} 10 0 10 100 0 0 0 0 0 0`).join("\n") +
    "\nintr 0\nctxt 0\n";

  const cpuinfoBody =
    cpuIds
      .map(
        id =>
          `processor\t: ${id}\n` +
          `model name\t: AMD EPYC 7713 64-Core Processor\n` +
          `cpu MHz\t\t: 2000.000\n`,
      )
      .join("\n") + "\n";

  using dir = tempDir("cpus-noncontiguous", {
    "proc/stat": statBody,
    "proc/cpuinfo": cpuinfoBody,
  });

  // Stage a scaling_cur_freq for every real CPU ID under the fake sysfs
  // tree so the frequency pass has something to read at the sparse paths.
  for (const id of cpuIds) {
    const freqDir = join(String(dir), "sys/devices/system/cpu", `cpu${id}`, "cpufreq");
    mkdirSync(freqDir, { recursive: true });
    // 2,000,000 kHz -> 2000 MHz after /1000
    writeFileSync(join(freqDir, "scaling_cur_freq"), "2000000\n");
  }

  // os.cpus() returns a lazy-populated array sized to the *real* host's
  // CPU count (hostCpuCount) whose per-slot getters trigger a single
  // populate() from the binding. Read a field to force populate, then
  // slice to the populated length so the outer shape reflects the fake
  // procfs — not the CI host's real CPU count.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "const cpus = require('os').cpus(); void cpus[0]?.model; console.log(JSON.stringify(cpus.slice(0, cpus.length)));",
    ],
    env: { ...bunEnv, BUN_DEBUG_CPUS_PROCFS_ROOT: String(dir) },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Released bun (USE_SYSTEM_BUN=1) without the fix dies here with
  // `Failed to get CPU information` (ERR_SYSTEM_ERROR) on stderr and a
  // non-zero exit. Check exitCode + parsed stdout; ignore ASAN-build
  // noise on stderr.
  expect(exitCode, `stderr: ${stderr}`).toBe(0);

  const cpus = JSON.parse(stdout);
  expect(cpus).toHaveLength(cpuIds.length);
  for (const cpu of cpus) {
    expect(cpu).toEqual({
      model: "AMD EPYC 7713 64-Core Processor",
      speed: 2000,
      times: {
        user: 100, // 10 ticks * scale 10
        nice: 0,
        sys: 100,
        idle: 1000,
        irq: 0,
      },
    });
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
