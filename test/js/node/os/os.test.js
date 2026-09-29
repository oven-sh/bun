import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { isIPv4, isIPv6 } from "node:net";
import * as os from "node:os";
import { join } from "node:path";

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

    try {
      process.env.TMPDIR = "/boop";
      expect(os.tmpdir()).toBe("/boop");
    } finally {
      // An assignment of undefined stores the string "undefined".
      if (originalEnv === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalEnv;
    }
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

// Runs the real os.cpus() in a child whose opens of /proc/stat, /proc/cpuinfo and
// /sys/devices/system/cpu/ go to staged files. Each staged file gives every CPU id
// its own value, so an entry that is filled from the wrong id fails.
const cc = isLinux ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;

// Compiles redirect-open.c. `path` is undefined where ptrace is not permitted.
async function buildRedirectOpen() {
  const dir = tempDir("os-cpus-redirect-open", {});
  const path = join(String(dir), "redirect-open");
  const run = async cmd => {
    await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { output: stdout + stderr, exitCode };
  };
  const compile = await run([cc, "-O1", "-o", path, join(import.meta.dir, "redirect-open.c")]);
  if (compile.exitCode !== 0) return { dir, error: compile.output };
  // 126: the kernel or a sandbox does not permit ptrace.
  const probe = await run([path, "/proc/stat", "--", "true"]);
  return { dir, path: probe.exitCode === 126 ? undefined : path };
}
// describe.skipIf needs the answer when the file loads, so this cannot wait for beforeAll.
const redirectOpen = cc ? await buildRedirectOpen() : undefined;

afterAll(() => {
  redirectOpen?.dir[Symbol.dispose]();
});

// A compile error fails the tests below. Only a host that cannot run the supervisor skips them.
const canRedirectOpen = redirectOpen?.path !== undefined || redirectOpen?.error !== undefined;

describe.skipIf(!canRedirectOpen)("cpus on staged /proc and /sys files", () => {
  beforeAll(() => {
    expect(redirectOpen.error).toBeUndefined();
  });

  const statFile = lines =>
    "cpu  100 0 100 1000 0 0 0 0 0 0\n" +
    lines.map(line => line + "\n").join("") +
    "intr 0\nctxt 1\nbtime 1700000000\nprocesses 1\nprocs_running 1\nprocs_blocked 0\n";
  const statLine = id => `cpu${id} ${id + 1} 0 10 100 0 0 0 0 0 0`;
  const modelOf = id => `EPYC 7713 (kind ${id % 8})`;

  function layout({ stat, cpuinfo = stat, cpufreq = stat, ...files }) {
    files["proc/stat"] ??= statFile(stat.map(statLine));
    if (cpuinfo) {
      files["proc/cpuinfo"] ??= cpuinfo
        .map(id => `processor\t: ${id}\nvendor_id\t: AuthenticAMD\nmodel name\t: ${modelOf(id)}\n\n`)
        .join("");
    }
    for (const id of cpufreq || []) {
      files[`sys/devices/system/cpu/cpu${id}/cpufreq/scaling_cur_freq`] ??= `${(id + 1) * 1000}\n`;
    }
    return files;
  }

  const cpu = (id, { model = modelOf(id), speed = id + 1, user = (id + 1) * 10 } = {}) => ({
    model,
    speed,
    times: { user, nice: 0, sys: 100, idle: 1000, irq: 0 },
  });

  async function cpusOn(layouts) {
    using root = tempDir("os-cpus", layouts);
    // LeakSanitizer cannot stop the threads of a process that is already traced.
    const asanOptions = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
    await using proc = Bun.spawn({
      cmd: [
        redirectOpen.path,
        "/proc/stat",
        "/proc/cpuinfo",
        "/sys/devices/system/cpu/",
        "--",
        bunExe(),
        join(import.meta.dir, "cpus-fixture.ts"),
        ...Object.keys(layouts).map(name => join(String(root), name)),
      ],
      env: { ...bunEnv, ASAN_OPTIONS: asanOptions, LSAN_OPTIONS: "detect_leaks=0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("[redirect-open] redirected opens:");
    expect(exitCode, stderr).toBe(0);
    return JSON.parse(stdout);
  }

  it.concurrent("reads each CPU from the files", async () => {
    const seen = await cpusOn({
      four: layout({ stat: [0, 1, 2, 3] }),
      bare: layout({ stat: [0, 1], cpuinfo: null, cpufreq: null }),
    });
    expect(seen).toEqual({
      four: [cpu(0), cpu(1), cpu(2), cpu(3)],
      bare: [cpu(0, { model: "unknown", speed: 0 }), cpu(1, { model: "unknown", speed: 0 })],
    });
  });
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

      if (nI.family === "IPv4") {
        expect(isIPv4(nI.address)).toBeTrue();
        expect(isIPv4(nI.netmask)).toBeTrue();
      }
      if (nI.family === "IPv6") {
        expect(nI.scopeid).toBeNumber();
        expect(nI.scope_id).toBeUndefined();
        expect(isIPv6(nI.address)).toBeTrue();
        // Node exposes the zone only via the numeric `scopeid` field, never
        // inline in `address`/`cidr`.
        expect(nI.address).not.toContain("%");
        expect(isIPv6(nI.netmask)).toBeTrue();
        if (nI.cidr) {
          const [addr, suffix] = nI.cidr.split("/");
          expect(isIPv6(addr)).toBeTrue();
          expect(addr).not.toContain("%");
          expect(Number(suffix)).toBeWithin(0, 129);
        }
      }
    }
  }
});

it("networkInterfaces IPv6 loopback", () => {
  // The loopback interface's IPv6 address/netmask/cidr must be the actual
  // address, not a placeholder like "<addr family=...>".
  const entries = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i.internal && i.family === "IPv6" && i.scopeid === 0);
  // Skip on hosts where IPv6 is disabled entirely (no ::1 on lo). The preceding
  // test still catches the regression for any IPv6 entries that do exist.
  if (entries.length === 0) return;
  const lo = entries.find(e => e.address === "::1") ?? entries[0];
  expect(lo).toEqual({
    address: "::1",
    cidr: "::1/128",
    netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    family: "IPv6",
    mac: expect.stringMatching(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
    internal: true,
    scopeid: 0,
  });
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

it("setPriority throws ESRCH for a nonexistent pid", () => {
  // 0x7ffffffe is above any pid the OS hands out.
  expect(() => os.setPriority(0x7ffffffe, 0)).toThrow(
    expect.objectContaining({
      name: "SystemError",
      message: "A system error occurred: uv_os_setpriority returned ESRCH (no such process)",
      code: "ERR_SYSTEM_ERROR",
      syscall: "uv_os_setpriority",
      info: { errno: isWindows ? -4040 : -3, code: "ESRCH", message: "no such process", syscall: "uv_os_setpriority" },
    }),
  );
});
