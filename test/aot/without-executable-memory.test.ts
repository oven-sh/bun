import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isLinux, isMacOS, isWindows, libcPathForDlopen, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isHardened, locksEnvironment } from "./hardened";
import { unsupported, withoutCoreDump } from "./run-programs";

const programs = join(import.meta.dir, "without-executable-memory");
const control = "asks-for-executable-memory";
const counts = "regions-for-generated-code";
const names = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .filter(name => name !== control)
  .sort();

const hasLinuxKernel = isLinux || isAndroid;

const refusesOnLinux = `import { dlopen, FFIType, ptr } from "bun:ffi";
const libc = dlopen(${JSON.stringify(hasLinuxKernel ? libcPathForDlopen() : "")}, {
  prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  execv: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
});
const load = 0x20, jumpIfEqual = 0x15, jumpIfAnyBitSet = 0x45, answer = 0x06;
const allow = 0x7fff0000, permissionDenied = process.argv[3] === "refuse" ? 0x00050000 | 13 : 0x80000000;
const systemCall = 0, architecture = 4, protection = 32, flags = 40;
const [thisArchitecture, mmap, mprotect, pkeyMprotect] = process.arch === "arm64" ? [0xc00000b7, 222, 226, 288] : [0xc000003e, 9, 10, 329];
const instructions = [
  [load, 0, 0, architecture], [jumpIfEqual, 1, 0, thisArchitecture], [answer, 0, 0, allow],
  [load, 0, 0, systemCall],
  [jumpIfEqual, 0, 5, mmap],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 8, 4],
  [load, 0, 0, flags], [jumpIfAnyBitSet, 0, 6, 0x20], [answer, 0, 0, permissionDenied],
  [jumpIfEqual, 1, 0, mprotect], [jumpIfEqual, 0, 3, pkeyMprotect],
  [load, 0, 0, protection], [jumpIfAnyBitSet, 0, 1, 4], [answer, 0, 0, permissionDenied],
  [answer, 0, 0, allow],
];
const filter = new Uint8Array(instructions.length * 8);
const view = new DataView(filter.buffer);
instructions.forEach(([code, ifTrue, ifFalse, operand], i) => {
  view.setUint16(i * 8, code, true);
  view.setUint8(i * 8 + 2, ifTrue);
  view.setUint8(i * 8 + 3, ifFalse);
  view.setUint32(i * 8 + 4, operand, true);
});
const filterProgram = new BigUint64Array([BigInt(instructions.length), BigInt(ptr(filter))]);
const path = Buffer.from(process.argv[2] + "\\0");
const argv = new BigUint64Array([BigInt(ptr(path)), 0n]);
const setNoNewPrivileges = 38, setSeccomp = 22, filterMode = 2;
if (libc.symbols.prctl(setNoNewPrivileges, 1, 0, 0, 0)) throw new Error("PR_SET_NO_NEW_PRIVS was refused");
if (libc.symbols.prctl(setSeccomp, filterMode, ptr(filterProgram), 0, 0)) throw new Error("the filter was refused");
libc.symbols.execv(ptr(path), ptr(argv));
throw new Error("execv failed");
`;

const refusesOnWindows = `import { dlopen, FFIType, ptr } from "bun:ffi";
const kernel32 = dlopen("kernel32.dll", {
  InitializeProcThreadAttributeList: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  UpdateProcThreadAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
  GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  GetStdHandle: { args: [FFIType.u32], returns: FFIType.u64 },
  SetHandleInformation: { args: [FFIType.u64, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
});
const mitigationPolicy = 0x20007, prohibitDynamicCode = 1n << 36n, extendedStartupInformation = 0x80000, usesStandardHandles = 0x100, inherit = 1;
const size = new BigUint64Array(1);
kernel32.symbols.InitializeProcThreadAttributeList(null, 1, 0, ptr(size));
const attributes = new Uint8Array(Number(size[0]));
if (!kernel32.symbols.InitializeProcThreadAttributeList(ptr(attributes), 1, 0, ptr(size))) throw new Error("the list of attributes was refused");
const policy = new BigUint64Array([prohibitDynamicCode]);
if (!kernel32.symbols.UpdateProcThreadAttribute(ptr(attributes), 0, mitigationPolicy, ptr(policy), policy.byteLength, null, null)) throw new Error("the policy was refused");
const startup = new DataView(new ArrayBuffer(112));
startup.setUint32(0, startup.byteLength, true);
startup.setUint32(60, usesStandardHandles, true);
[-10, -11, -12].forEach((which, i) => {
  const handle = BigInt(kernel32.symbols.GetStdHandle(which >>> 0));
  kernel32.symbols.SetHandleInformation(handle, inherit, inherit);
  startup.setBigUint64(80 + i * 8, handle, true);
});
startup.setBigUint64(104, BigInt(ptr(attributes)), true);
const commandLine = Buffer.from('"' + process.argv[2] + '"\\0', "utf16le");
const started = new BigUint64Array(3);
if (!kernel32.symbols.CreateProcessW(null, ptr(commandLine), null, null, 1, extendedStartupInformation, null, null, ptr(new Uint8Array(startup.buffer)), ptr(started))) throw new Error("CreateProcessW failed");
kernel32.symbols.WaitForSingleObject(started[0], 0xffffffff);
const exitCode = new Uint32Array(1);
kernel32.symbols.GetExitCodeProcess(started[0], ptr(exitCode));
process.exit(exitCode[0]);
`;
const refuses = isWindows ? refusesOnWindows : refusesOnLinux;

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, ...(locksEnvironment ? { BUN_ENABLE_CRASH_REPORTING: "0" } : { BUN_CRASH_REPORT_URL: "" }) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

const tsconfigWithTypesOfBun = JSON.stringify({
  compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
});

async function build(name: string, directory: string) {
  const executable = join(directory, name + (isWindows ? ".exe" : ""));
  await Bun.write(join(directory, name + ".ts"), Bun.file(join(programs, name + ".ts")));
  await Bun.write(join(directory, "tsconfig.json"), tsconfigWithTypesOfBun);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", join(directory, name + ".ts"), "--outfile", executable],
    directory,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

const isSupported = !unsupported;

async function whereItIsRefused(executable: string, directory: string, onLinux: "refuse" | "kill" = "kill") {
  if (hasLinuxKernel || isWindows)
    return run(withoutCoreDump([bunExe(), join(directory, "refuses.ts"), executable, onLinux]));
  const signed = await run(["codesign", "--force", "--sign", "-", "--options", "runtime", executable]);
  expect(signed.exitCode).toBe(0);
  return run([executable]);
}

// A Mac with System Integrity Protection off does not enforce the hardened runtime: nothing is refused there, so the control has nothing to show. The regions are counted all the same.
async function isRefusedNowhere() {
  if (!isMacOS || !isSupported) return false;
  using dir = tempDir("aot-without-executable-memory-control", {});
  return (await whereItIsRefused(await build(control, String(dir)), String(dir))).stdout === "granted\n";
}
const refusedNowhere = await isRefusedNowhere();
if (refusedNowhere)
  console.error(
    "SKIPPED: the control of test/aot/without-executable-memory.test.ts: this machine does not enforce the hardened runtime: an executable signed with it, without the entitlement, is granted memory for generated code",
  );

describe.skipIf(!isSupported)("an executable needs no permission to make memory executable", () => {
  test.skipIf(refusedNowhere)(
    "the control: what asks for executable memory gets it, and is refused it there",
    async () => {
      using dir = tempDir("aot-without-executable-memory", { "refuses.ts": refuses });
      const executable = await build(control, String(dir));
      const hasDeniedItself = isHardened || (await run([executable, "has-it-denied-itself"])).stdout === "yes\n";
      expect(await run([executable])).toEqual({
        stdout: hasDeniedItself ? "refused\n" : "granted\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
      expect(await whereItIsRefused(executable, String(dir), "refuse")).toEqual({
        stdout: "refused\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
      if (hasLinuxKernel)
        expect(await whereItIsRefused(executable, String(dir))).toMatchObject({ stdout: "", signalCode: "SIGSYS" });
    },
    120_000,
  );

  test("an executable has no region for generated code, and the same program with the JIT has", async () => {
    using dir = tempDir("aot-without-executable-memory", {});
    expect(await run([await build(counts, String(dir))])).toEqual({
      stdout: "0\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
    const withTheJIT = join(String(dir), "with-the-jit");
    const built = await run(
      [bunExe(), "build", "--compile", join(String(dir), counts + ".ts"), "--outfile", withTheJIT],
      String(dir),
    );
    expect(built.exitCode).toBe(0);
    expect(Number((await run([withTheJIT])).stdout)).toBeGreaterThan(0);
  }, 120_000);

  test.each(names)(
    "%s",
    async name => {
      using dir = tempDir("aot-without-executable-memory", { "refuses.ts": refuses });
      const executable = await build(name, String(dir));
      const free = await run([executable]);
      expect({ stderr: free.stderr, exitCode: free.exitCode, signalCode: free.signalCode }).toEqual({
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
      expect(free.stdout).not.toBe("");
      expect(await whereItIsRefused(executable, String(dir))).toEqual(free);
    },
    120_000,
  );
});
