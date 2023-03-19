import { it, expect } from "bun:test";
import * as os from "node:os";

it("arch", () => {
  expect(["x64", "x86", "arm64"].some(arch => os.arch() === arch)).toBe(true);
});

it("endianness", () => {
  expect(/[BL]E/.test(os.endianness())).toBe(true);
});

it("freemem", () => {
  expect(os.freemem() > 0).toBe(true);
});

it("totalmem", () => {
  expect(os.totalmem() > 0).toBe(true);
});

it("getPriority", () => {
  expect(os.getPriority()).toBe(0);
  expect(os.getPriority(0)).toBe(0);
});

it("setPriority", () => {
  expect(os.setPriority(0, 2)).toBe(undefined);
  expect(os.getPriority()).toBe(2);
  expect(os.setPriority(5)).toBe(undefined);
  expect(os.getPriority()).toBe(5);
});

it("loadavg", () => {
  expect(os.loadavg().length === 3).toBe(true);
});

it("homedir", () => {
  expect(os.homedir() !== "unknown").toBe(true);
});

it("tmpdir", () => {
  if (process.platform === "win32") {
    expect(os.tmpdir()).toBe(process.env.TEMP || process.env.TMP);
    expect(os.tmpdir()).toBe(`${process.env.SystemRoot || process.env.windir}\\temp`);
  } else {
    let dir = process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
    if (dir.length > 1 && dir.endsWith("/")) {
      dir = dir.substring(0, dir.length - 1);
    }
    expect(os.tmpdir()).toBe(dir);
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
  if (process.platform === "win32") expect(os.EOL).toBe("\\r\\n");
  else expect(os.EOL).toBe("\n");
});

it("devNull", () => {
  if (process.platform === "win32") expect(os.devNull).toBe("\\\\.\\nul");
  else expect(os.devNull).toBe("/dev/null");
});
