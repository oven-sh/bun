import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("WASI", () => {
  test("initialize() method exists on WASI instance", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { WASI } = require("node:wasi");
const wasi = new WASI({ version: "preview1" });
console.log(typeof wasi.initialize);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("getImportObject() method exists on WASI instance", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { WASI } = require("node:wasi");
const wasi = new WASI({ version: "preview1" });
console.log(typeof wasi.getImportObject);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("initialize() works with a reactor WASI module (no _start, with _initialize)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { WASI } = require("node:wasi");
const wasi = new WASI({ version: "preview1" });

// Minimal WASI reactor module: exports memory, _initialize (nop), add (i32.add)
const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,10,2,96,0,0,96,2,127,127,1,127,3,3,2,0,1,5,3,1,0,1,7,30,3,6,109,101,109,111,114,121,2,0,11,95,105,110,105,116,105,97,108,105,122,101,0,0,3,97,100,100,0,1,10,12,2,2,0,11,7,0,32,0,32,1,106,11]);

const module = new WebAssembly.Module(bytes);
const instance = new WebAssembly.Instance(module);

// This should NOT throw - it's the core fix for #12755
wasi.initialize(instance);

// Verify the module still works after initialization
const result = instance.exports.add(2, 3);
console.log(result);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("5");
    expect(exitCode).toBe(0);
  });

  test("initialize() throws if _start is exported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { WASI } = require("node:wasi");
const wasi = new WASI({ version: "preview1" });

// WASI command module: exports memory and _start (nop)
const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,3,1,0,1,7,19,2,6,109,101,109,111,114,121,2,0,6,95,115,116,97,114,116,0,0,10,4,1,2,0,11]);

const module = new WebAssembly.Module(bytes);
const instance = new WebAssembly.Instance(module);

try {
  wasi.initialize(instance);
  console.log("ERROR: should have thrown");
  process.exit(1);
} catch (e) {
  console.log("caught: " + e.message.includes("_start"));
}
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("caught: true");
    expect(exitCode).toBe(0);
  });

  test("getImportObject() returns object with wasi_snapshot_preview1 key", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const { WASI } = require("node:wasi");
const wasi = new WASI({ version: "preview1" });
const importObj = wasi.getImportObject();
console.log(typeof importObj.wasi_snapshot_preview1);
console.log(typeof importObj.wasi_snapshot_preview1.fd_write);
`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("object\nfunction");
    expect(exitCode).toBe(0);
  });
});
