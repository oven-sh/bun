import { describe, expect, it } from "bun:test";
import { readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { isIPv4, isIPv6 } from "node:net";
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

describe("userInfo", () => {
  // Runs `os.userInfo()` in a child whose account-related environment variables
  // are poisoned with `marker`. node reads the passwd database instead, so the
  // result must not depend on any of them.
  async function userInfoWithPoisonedEnv(marker) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdout.write(JSON.stringify(require("node:os").userInfo()))`],
      env: {
        ...bunEnv,
        USER: `nobody-${marker}`,
        LOGNAME: `nobody-${marker}`,
        USERNAME: `nobody-${marker}`,
        SHELL: `/not-a-real-shell-${marker}`,
        HOME: `/not-a-real-home-${marker}`,
        USERPROFILE: `/not-a-real-home-${marker}`,
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`child exited with ${exitCode}\n${stderr}`);
    return JSON.parse(stdout);
  }

  it.concurrent("is read from the operating system, not the environment", async () => {
    const [a, b] = await Promise.all([userInfoWithPoisonedEnv("a"), userInfoWithPoisonedEnv("b")]);

    // Two children that disagree on every relevant environment variable must
    // still report the same account.
    expect(a).toEqual(b);
    expect(a.username).not.toBe("nobody-a");
    expect(a.homedir).not.toBe("/not-a-real-home-a");
    expect(a.shell).not.toBe("/not-a-real-shell-a");
  });

  // getpwuid_r() goes through NSS, so /etc/passwd is only the source of truth
  // when the effective uid actually has a row there. It does in Bun's CI images.
  const passwdEntry = !isLinux
    ? undefined
    : readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .map(line => line.split(":"))
        .find(fields => fields.length >= 7 && Number(fields[2]) === process.geteuid());

  it.concurrent.skipIf(!passwdEntry)("reports the passwd entry of the effective uid", async () => {
    expect(await userInfoWithPoisonedEnv("passwd")).toEqual({
      uid: process.geteuid(),
      gid: Number(passwdEntry[3]),
      username: passwdEntry[0],
      homedir: passwdEntry[5],
      shell: passwdEntry[6],
    });
  });

  // The `docker run --user 12345` / distroless / OpenShift arbitrary-uid case:
  // a uid with no passwd entry must throw the same `ERR_SYSTEM_ERROR` node does,
  // not fabricate a record from the environment. Needs Linux `setpriv` + root.
  const canSetpriv = isLinux && process.geteuid?.() === 0 && Bun.which("setpriv") != null;
  it.concurrent.skipIf(!canSetpriv)("throws ERR_SYSTEM_ERROR when the effective uid has no passwd entry", async () => {
    // A uid that almost certainly has no /etc/passwd row in any CI image.
    const uid = "54321";
    await using proc = Bun.spawn({
      cmd: [
        "setpriv",
        `--reuid=${uid}`,
        `--regid=${uid}`,
        "--clear-groups",
        bunExe(),
        "-e",
        `const os = require("node:os");
         const out = {};
         for (const [name, fn] of [["userInfo", () => os.userInfo()], ["homedir", () => os.homedir()]]) {
           try {
             out[name] = { returned: fn() };
           } catch (e) {
             out[name] = { threw: { name: e.name, code: e.code, syscall: e.syscall, info: e.info?.code } };
           }
         }
         process.stdout.write(JSON.stringify(out));`,
      ],
      env: {
        ...bunEnv,
        // Poison $HOME / $USER / $SHELL so a fabricating implementation is
        // visibly wrong if it returns instead of throwing.
        HOME: "/not-a-real-home",
        USER: "not-a-real-user",
        SHELL: "/not-a-real-shell",
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      userInfo: {
        threw: { name: "SystemError", code: "ERR_SYSTEM_ERROR", syscall: "uv_os_get_passwd", info: "ENOENT" },
      },
      // os.homedir() checks $HOME first; with $HOME set it returns that verbatim.
      homedir: { returned: "/not-a-real-home" },
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent.skipIf(!canSetpriv)(
    "homedir() throws ERR_SYSTEM_ERROR when $HOME is unset and no passwd entry",
    async () => {
      const uid = "54321";
      const { HOME, USERPROFILE, ...envWithoutHome } = bunEnv;
      await using proc = Bun.spawn({
        cmd: [
          "setpriv",
          `--reuid=${uid}`,
          `--regid=${uid}`,
          "--clear-groups",
          bunExe(),
          "-e",
          `try { require("node:os").homedir() }
         catch (e) { process.stdout.write(JSON.stringify({ name: e.name, code: e.code, syscall: e.syscall })) }`,
        ],
        env: envWithoutHome,
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ name: "SystemError", code: "ERR_SYSTEM_ERROR", syscall: "uv_os_homedir" });
      expect(exitCode).toBe(0);
    },
  );

  it("has node's shape", () => {
    const info = os.userInfo();

    expect(Object.getPrototypeOf(info)).toBe(null);
    expect(Object.keys(info)).toEqual(["uid", "gid", "username", "homedir", "shell"]);
    expect(typeof info.username).toBe("string");
    expect(typeof info.homedir).toBe("string");

    if (isWindows) {
      expect(info.uid).toBe(-1);
      expect(info.gid).toBe(-1);
      expect(info.shell).toBe(null);
    } else {
      expect(info.uid).toBe(process.geteuid());
      expect(typeof info.shell).toBe("string");
    }
  });

  it("honors the encoding option", () => {
    const info = os.userInfo();
    const buf = os.userInfo({ encoding: "buffer" });

    expect(buf.uid).toBe(info.uid);
    expect(buf.gid).toBe(info.gid);
    expect(buf.username).toBeInstanceOf(Buffer);
    expect(buf.username.toString("utf8")).toBe(info.username);
    expect(buf.homedir).toBeInstanceOf(Buffer);
    expect(buf.homedir.toString("utf8")).toBe(info.homedir);

    if (isWindows) {
      expect(buf.shell).toBe(null);
    } else {
      expect(buf.shell).toBeInstanceOf(Buffer);
      expect(buf.shell.toString("utf8")).toBe(info.shell);
    }

    const hex = os.userInfo({ encoding: "hex" });
    expect(hex.username).toBe(Buffer.from(info.username).toString("hex"));
    expect(hex.homedir).toBe(Buffer.from(info.homedir).toString("hex"));
    expect(hex.shell).toBe(isWindows ? null : Buffer.from(info.shell).toString("hex"));
  });

  it("ignores options it cannot use, like node", () => {
    const info = os.userInfo();

    // Non-object options and non-string encodings fall back to utf8.
    expect(os.userInfo(42)).toEqual(info);
    expect(os.userInfo(null)).toEqual(info);
    expect(os.userInfo("buffer")).toEqual(info);
    expect(os.userInfo(() => {})).toEqual(info);
    expect(os.userInfo({ encoding: 42 })).toEqual(info);
    expect(os.userInfo({ encoding: undefined })).toEqual(info);
    expect(os.userInfo({ encoding: "not-an-encoding" })).toEqual(info);
  });

  it("propagates an encoding getter that throws", () => {
    expect(() =>
      os.userInfo({
        get encoding() {
          throw new Error("xyz");
        },
      }),
    ).toThrow("xyz");
  });
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
