// Temporary probe. Reports how a child sees an inheritable handle of the parent, for several ways of starting it.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = `
import { dlopen, FFIType, ptr } from "bun:ffi";
import { writeFileSync } from "node:fs";
const k = dlopen("kernel32.dll", {
  GetStdHandle: { args: [FFIType.u32], returns: FFIType.u64 },
  GetFinalPathNameByHandleW: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u32 },
  GetHandleInformation: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  GetProcessHandleCount: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  GetCurrentProcess: { args: [], returns: FFIType.u64 },
  GetLastError: { args: [], returns: FFIType.u32 },
});
function pathOf(handle) {
  const buffer = new Uint16Array(32768);
  const length = k.symbols.GetFinalPathNameByHandleW(handle, ptr(buffer), buffer.length, 0);
  if (length === 0 || length > buffer.length) return "no path " + k.symbols.GetLastError();
  return Buffer.from(buffer.buffer, 0, length * 2).toString("utf16le");
}
const h = BigInt(process.argv[2]);
const flags = new Uint32Array(1);
const ok = k.symbols.GetHandleInformation(h, ptr(flags));
const err = k.symbols.GetLastError();
const count = new Uint32Array(1);
k.symbols.GetProcessHandleCount(BigInt(k.symbols.GetCurrentProcess()), ptr(count));
writeFileSync(process.argv[3], JSON.stringify({
  handle: process.argv[2], ok, err, flags: flags[0], path: pathOf(h), handles: count[0],
  stdin: pathOf(BigInt(k.symbols.GetStdHandle(-10 >>> 0))),
}));
`;

test.skipIf(!isWindows)("probe", async () => {
  const k = dlopen("kernel32.dll", {
    CreateFileW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.u64,
    },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetHandleInformation: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    GetProcessHandleCount: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    InitializeProcThreadAttributeList: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    UpdateProcThreadAttribute: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    CreateProcessW: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.i32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
    GetStdHandle: { args: [FFIType.u32], returns: FFIType.u64 },
    SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
  });
  using dir = tempDir("probe-handle-list", { "fixture.ts": fixture, "extra.txt": "", "stdin.txt": "" });
  const report: Record<string, unknown> = {};
  const sa = new DataView(new ArrayBuffer(24));
  sa.setUint32(0, 24, true);
  sa.setUint32(16, 1, true);
  const open = (name: string) =>
    k.symbols.CreateFileW(
      ptr(Buffer.from(join(String(dir), name) + "\0", "utf16le")),
      0x80000000,
      7,
      ptr(new Uint8Array(sa.buffer)),
      3,
      0x80,
      null,
    );
  const extra = open("extra.txt");
  const flags = new Uint32Array(1);
  report.parentGetHandleInformation = [k.symbols.GetHandleInformation(extra, ptr(flags)), flags[0]];
  const count = new Uint32Array(1);
  k.symbols.GetProcessHandleCount(BigInt(k.symbols.GetCurrentProcess()), ptr(count));
  report.parentHandles = count[0];

  const out = (name: string) => join(String(dir), name + ".json");
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(out(name), "utf8"));
    } catch (e) {
      return String(e);
    }
  };

  // A: Bun.spawn
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "fixture.ts"), String(extra), out("a")],
      env: bunEnv,
      stdin: Bun.file(join(String(dir), "stdin.txt")),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    report.a = { stdout, stderr, exitCode, child: read("a") };
  }

  // A2: Bun.spawn from a child bun, whose stderr (where uv_spawn prints) is captured
  {
    const script = `
      const extra = process.argv[1];
      const proc = Bun.spawn({ cmd: [${JSON.stringify(bunExe())}, ${JSON.stringify(join(String(dir), "fixture.ts"))}, extra, ${JSON.stringify(out("a2"))}], stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      await proc.exited;
      console.log("child exit " + proc.exitCode);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, String(extra)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    report.a2 = { stdout, stderr, exitCode, child: read("a2") };
  }

  const spawnFfi = (name: string, inherit: number, handleList: bigint[] | null) => {
    const startup = new DataView(new ArrayBuffer(112));
    startup.setUint32(0, 112, true);
    let flags = 0;
    let attributes: Uint8Array | null = null;
    if (handleList) {
      const size = new BigUint64Array(1);
      k.symbols.InitializeProcThreadAttributeList(null, 1, 0, ptr(size));
      attributes = new Uint8Array(Number(size[0]));
      if (!k.symbols.InitializeProcThreadAttributeList(ptr(attributes), 1, 0, ptr(size))) throw new Error("init");
      const list = new BigUint64Array(handleList);
      if (!k.symbols.UpdateProcThreadAttribute(ptr(attributes), 0, 0x20002, ptr(list), list.byteLength, null, null))
        throw new Error("update " + k.symbols.GetLastError());
      startup.setBigUint64(104, BigInt(ptr(attributes)), true);
      flags |= 0x80000;
      report[name + "List"] = handleList.map(String);
    }
    const commandLine = Buffer.from(
      `"${process.execPath}" "${join(String(dir), "fixture.ts")}" ${extra} "${out(name)}"\0`,
      "utf16le",
    );
    const started = new BigUint64Array(3);
    const ok = k.symbols.CreateProcessW(
      null,
      ptr(commandLine),
      null,
      null,
      inherit,
      flags | 0x400,
      null,
      null,
      ptr(new Uint8Array(startup.buffer)),
      ptr(started),
    );
    if (!ok) {
      report[name] = "CreateProcessW failed " + k.symbols.GetLastError();
      return;
    }
    k.symbols.WaitForSingleObject(started[0], 60000);
    report[name] = read(name);
  };
  // C: plain CreateProcessW, inherit all
  spawnFfi("c", 1, null);
  // D: CreateProcessW, inherit nothing
  spawnFfi("d", 0, null);
  // B: CreateProcessW with a handle list that holds one unrelated inheritable handle
  const other = open("stdin.txt");
  spawnFfi("b", 1, [BigInt(other)]);
  k.symbols.CloseHandle(other);
  k.symbols.CloseHandle(extra);
  expect(JSON.stringify(report, null, 1)).toBe("");
});
