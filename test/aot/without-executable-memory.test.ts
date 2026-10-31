import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isDebug, isLinux, isMacOS, isWindows, libcPathForDlopen, tempDir } from "harness";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened, locksEnvironment } from "./hardened";
import { built, spawned, unsupported, withoutCoreDump } from "./harness/commands";
import { withoutDebugInformation } from "./harness/without-debug-information";

const programs = join(import.meta.dir, "without-executable-memory");
const control = "asks-for-executable-memory";
const counts = "regions-for-generated-code";
const names = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .map(name => name.slice(0, -3))
  .filter(name => name !== control)
  .sort();

// What each program prints. A program that is added to the folder gets a line here.
const printed: Record<string, string> = {
  "callbacks-from-foreign-functions": "1,3,5,9\n",
  "classes-maps-and-promises": 'TypeError\n707108.284 42 {"a":[1,2,{"b":"c"}]} 42\n',
  "code-made-at-run-time": "60900000000 44999850000\n",
  "foreign-functions": "5\n",
  "hot-runtime-regexp": "(a+b|c)*d[0-9]{2,}x? 400000 4666660\n",
  "many-runtime-regexps": "8000 a+b+c 1,22,333\n",
  "regions-for-generated-code": "0\n",
  "server-and-client": "hello /199 true 3\n",
  "webassembly": "-1474936480\n",
};

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

const tsconfigWithTypesOfBun = JSON.stringify({
  compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
});

const folder = tempDir("aot-without-executable-memory", {
  "refuses.ts": refuses,
  "tsconfig.json": tsconfigWithTypesOfBun,
  ...Object.fromEntries(
    [control, ...names].map(name => [name + ".ts", readFileSync(join(programs, name + ".ts"), "utf8")]),
  ),
});
afterAll(() => folder[Symbol.dispose]());
const directory = String(folder);

// The commands of all tests start together and share the processors, so a command can take as long as the whole file.
// A debug build is slow. On a Mac the first start of a new executable has taken seconds, and this file starts twenty of them at about the same time.
const limitOfACommand = isMacOS || isDebug ? 240_000 : undefined;
// A command that hangs is ended at its limit, and that fails its test at once. So a test only needs more time than a build and the run behind it may take.
const limitOfATest = 600_000;

const env = { ...bunEnv, ...(locksEnvironment ? { BUN_ENABLE_CRASH_REPORTING: "0" } : { BUN_CRASH_REPORT_URL: "" }) };
const run = (cmd: string[]) => spawned(cmd, directory, env, limitOfACommand);

/** `bun build --compile <flags>` of a program of the folder. */
async function compile(name: string, outfile: string, ...flags: string[]) {
  const executable = join(directory, outfile + (isWindows ? ".exe" : ""));
  const source = join(directory, name + ".ts");
  built(
    await run([bunExe(), "build", "--compile", ...flags, ...withoutDebugInformation, source, "--outfile", executable]),
  );
  return executable;
}

const executables = new Map<string, Promise<string>>();
/** Each program is built once with `--aot`, for the first test that asks. */
const build = (name: string) => executables.getOrInsertComputed(name, () => compile(name, name, "--aot"));

const isSupported = !unsupported;

const startedHardened = new Map<string, ReturnType<typeof run>>();
function whereItIsRefused(executable: string, onLinux: "refuse" | "kill" = "kill") {
  if (hasLinuxKernel || isWindows)
    return run(withoutCoreDump([bunExe(), join(directory, "refuses.ts"), executable, onLinux]));
  // One copy with the hardened runtime for each executable, started once: the control is asked before the tests, and its test reads the same answer.
  return startedHardened.getOrInsertComputed(executable, async () => {
    const hardened = executable + "-hardened";
    copyFileSync(executable, hardened);
    const signed = await run(["codesign", "--force", "--sign", "-", "--options", "runtime", hardened]);
    expect({ stderr: signed.stderr, exitCode: signed.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    return run([hardened]);
  });
}

/** What a run that prints `stdout` and nothing else comes to. */
const prints = (stdout: string | ReturnType<typeof expect.stringMatching>) => ({
  stdout,
  stderr: "",
  exitCode: 0,
  signal: null,
});

// A Mac with System Integrity Protection off does not enforce the hardened runtime: nothing is refused there, so the control has nothing to show. The regions are counted all the same.
// Only a run that prints `granted` and nothing else says so. Any other run is for the control to report.
async function isRefusedNowhere() {
  if (!isMacOS || !isSupported) return false;
  return Bun.deepEquals(await whereItIsRefused(await build(control)), prints("granted\n"));
}
const refusedNowhere = await isRefusedNowhere();
if (refusedNowhere)
  console.error(
    "SKIPPED: the control of test/aot/without-executable-memory.test.ts: this machine does not enforce the hardened runtime: an executable signed with it, without the entitlement, is granted memory for generated code",
  );

describe.skipIf(!isSupported)("an executable needs no permission to make memory executable", () => {
  test.concurrent.skipIf(refusedNowhere)(
    "the control: what asks for executable memory gets it, and is refused it there",
    async () => {
      const executable = await build(control);
      // A hardened build has always denied itself such memory. Another has where the kernel has a request for that (Linux since 6.3), so it is asked.
      const [asked, free, refused, killed] = await Promise.all([
        hasLinuxKernel && !isHardened ? run([executable, "has-it-denied-itself"]) : undefined,
        run([executable]),
        whereItIsRefused(executable, "refuse"),
        hasLinuxKernel ? whereItIsRefused(executable) : undefined,
      ]);
      if (asked) expect(asked).toEqual(prints(expect.stringMatching(/^(yes|no)\n$/)));
      const hasDeniedItself = isHardened || asked?.stdout === "yes\n";
      expect(free).toEqual(prints(hasDeniedItself ? "refused\n" : "granted\n"));
      expect(refused).toEqual(prints("refused\n"));
      if (killed) expect(killed).toMatchObject({ stdout: "", stderr: "", signal: "SIGSYS" });
    },
    limitOfATest,
  );

  test.concurrent(
    "an executable has no region for generated code, and the same program with the JIT has",
    async () => {
      const [compiled, withTheJIT] = await Promise.all([
        build(counts).then(executable => run([executable])),
        compile(counts, "with-the-jit").then(executable => run([executable])),
      ]);
      expect(compiled).toEqual(prints("0\n"));
      expect(withTheJIT).toEqual(prints(expect.stringMatching(/^[1-9][0-9]*\n$/)));
    },
    limitOfATest,
  );

  test.concurrent.each(names)(
    "%s",
    async name => {
      const executable = await build(name);
      const [free, refused] = await Promise.all([run([executable]), whereItIsRefused(executable)]);
      expect(free).toEqual(prints(printed[name]));
      expect(refused).toEqual(prints(printed[name]));
    },
    limitOfATest,
  );
});
