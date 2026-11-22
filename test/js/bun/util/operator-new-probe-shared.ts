// Temporary, not for merge. Collects facts from the macOS CI machines for oven-sh/bun#49416, on a build WITHOUT its
// fix: which reproductions of "LLVM ERROR: out of memory" abort there. It fails on purpose so that the job log and the
// annotation carry the report.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, isMacOS } from "harness";
import os from "os";
import { join } from "path";

async function run(cmd: string[]) {
  await using child = Bun.spawn({
    cmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 45_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout: stdout.slice(-1500), stderr: stderr.slice(0, 1500), exitCode, signalCode: child.signalCode };
}

async function text(cmd: string[]) {
  try {
    const { stdout, stderr } = await run(cmd);
    return (stdout || stderr).trim();
  } catch (error) {
    return String(error);
  }
}

// operator new(size_t, std::align_val_t, const std::nothrow_t&), as the process binds it, called through bun:ffi.
const callsAlignedNothrowNew = `
const { CFunction, dlopen, FFIType } = require("bun:ffi");
const { dlsym } = dlopen("/usr/lib/libSystem.B.dylib", {
  dlsym: { args: [FFIType.i64, FFIType.cstring], returns: FFIType.ptr },
}).symbols;
const find = name => dlsym(-2n, Buffer.from(name + "\\0"));
const alignedNew = CFunction({
  ptr: find("_ZnwmSt11align_val_tRKSt9nothrow_t"),
  args: [FFIType.u64, FFIType.u64, FFIType.ptr],
  returns: FFIType.ptr,
});
const result = {};
for (const align of [1, 2, 4, 8, 16]) result[align] = alignedNew(256, align, find("_ZSt7nothrow")) === null ? "null" : "a pointer";
console.log(JSON.stringify(result));
`;

const loadsLibrary = `
require("bun:ffi").dlopen(process.argv[1], { LLVMContextCreate: { returns: "ptr" } });
console.log("loaded");
`;

// Several test files call this, so that the shards of a lane run it on several machines.
export function probe() {
  test.skipIf(!isMacOS)("probe: what aborts on this machine without the fix", collect, 300_000);
}

async function collect() {
  const llvmLibraries: string[] = [];
  const kegs: Record<string, string[]> = {};
  for (const prefix of ["/opt/homebrew/opt", "/usr/local/opt"]) {
    if (!existsSync(prefix)) continue;
    kegs[prefix] = readdirSync(prefix).filter(name => name.startsWith("llvm"));
    for (const keg of kegs[prefix]) {
      const library = join(prefix, keg, "lib", "libLLVM.dylib");
      if (existsSync(library)) llvmLibraries.push(library);
    }
  }

  const report = {
    bun: `${Bun.version} ${Bun.revision.slice(0, 9)}`,
    agent: process.env.BUILDKITE_AGENT_NAME ?? null,
    hostname: os.hostname(),
    arch: process.arch,
    macOS: await text(["/usr/bin/sw_vers", "-productVersion"]),
    model: await text(["/usr/sbin/sysctl", "-n", "hw.model"]),
    virtualMachine: await text(["/usr/sbin/sysctl", "-n", "kern.hv_vmm_present"]),
    darwin: os.release(),
    kegs,
    alignedNothrowNew: await run([bunExe(), "-e", callsAlignedNothrowNew]),
    libLLVM: Object.fromEntries(
      await Promise.all(
        llvmLibraries.map(async library => [library, await run([bunExe(), "-e", loadsLibrary, library])]),
      ),
    ),
    metalFX: await run([bunExe(), join(import.meta.dir, "operator-new-probe-metalfx-fixture.ts")]),
  };
  console.log("PROBE REPORT " + JSON.stringify(report, null, 2));
  expect(report).toEqual("this probe fails on purpose: the report is what was received" as any);
}
