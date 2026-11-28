import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS, strictSystemAllocatorEnv } from "harness";
import { join } from "path";
import { groups } from "./system-library-calls-fixture";

const fixture = join(import.meta.dir, "system-library-calls-fixture.ts");
const divisor = isDebug || isASAN ? "10" : "1";
// The frameworks behind these write logs of their own to stdout and stderr.
const logsOnMacOS = ["images", "web views", "secrets"];
const complaint = /malloc|alloc|freed|corrupt|panic|crash|abort|signal|fault/i;
// Homebrew's LLVM 23, which builds Bun on macOS. Its static initializers call
// operator new(size, std::align_val_t(4), std::nothrow), and LLVM aborts with "LLVM ERROR: out of memory" on null.
const libLLVM = ["/opt/homebrew", "/usr/local"]
  .map(prefix => `${prefix}/opt/llvm@23/lib/libLLVM.dylib`)
  .find(library => isMacOS && existsSync(library));

describe.each([
  ["the system allocator as it is", { MallocDebugReport: "crash" }],
  ["the system allocator checking itself", strictSystemAllocatorEnv],
])("with %s", (_, env) => {
  test.concurrent.each(Object.keys(groups))(
    "%s",
    async group => {
      // How far the others have got when a process exits differs from run to run.
      for (let run = group.startsWith("process.exit") ? 10 : 1; run > 0; run--) {
        await using child = Bun.spawn({
          cmd: [bunExe(), fixture, group, divisor],
          env: { ...bunEnv, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
        const hasLogs = isMacOS && logsOnMacOS.includes(group);
        const relevant = hasLogs
          ? stderr
              .split("\n")
              .filter(line => complaint.test(line))
              .join("\n")
          : stderr;
        expect({
          stdout: hasLogs ? stdout.slice(stdout.lastIndexOf("\n", stdout.length - 2) + 1) : stdout,
          stderr: relevant,
          exitCode,
          signalCode: child.signalCode,
        }).toEqual({
          stdout: "done\n",
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      }
    },
    180_000,
  );

  test.concurrent.skipIf(!libLLVM)("a library that calls operator new with an alignment of 4 loads", async () => {
    await using child = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("bun:ffi").dlopen(process.argv[1], { LLVMContextCreate: { returns: "ptr" } }); console.log("done");`,
        libLLVM!,
      ],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout, stderr, exitCode, signalCode: child.signalCode }).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

// What dyld answers when an image asks for an operator by name: dlsym() in an addon, an image of a flat namespace.
const lookUpOperators = `
  const { CString, dlopen } = require("bun:ffi");
  const { dladdr, dlsym } = dlopen("/usr/lib/libSystem.B.dylib", {
    dladdr: { args: ["ptr", "ptr"], returns: "i32" },
    dlsym: { args: ["i64", "cstring"], returns: "ptr" },
  }).symbols;
  const RTLD_DEFAULT = -2n;
  const RTLD_MAIN_ONLY = -5n;
  const find = (handle, name) => dlsym(handle, Buffer.from(name + "\\0"));
  const executable = BigInt(find(RTLD_MAIN_ONLY, "_mh_execute_header"));
  // A Dl_info starts with dli_fname and dli_fbase.
  const info = new BigUint64Array(4);
  function imageOf(name) {
    if (!dladdr(find(RTLD_DEFAULT, name), info)) return "no image";
    return info[1] === executable ? "the executable" : new CString(Number(info[0])).toString();
  }
  console.log(JSON.stringify({ "operator new": imageOf("_Znwm"), "operator delete": imageOf("_ZdlPv") }));
`;

// An ASAN build has operators of ASAN's in front of both.
test.skipIf(!isMacOS || isASAN)(
  "a lookup by name finds the operator new and the operator delete of the C++ library, not the executable's",
  async () => {
    await using child = Bun.spawn({
      cmd: [bunExe(), "-e", lookUpOperators],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout, stderr, exitCode, signalCode: child.signalCode }).toEqual({
      stdout:
        JSON.stringify({
          "operator new": "/usr/lib/libc++abi.dylib",
          "operator delete": "/usr/lib/libc++abi.dylib",
        }) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
);

// For an operator that the executable exports, dyld writes every use of it in the shared cache when the process
// starts. An ASAN build has no operators of its own.
test.skipIf(!isMacOS || isASAN)("dyld points no use of an operator in the shared cache at the executable", async () => {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", "0"],
    env: { ...bunEnv, DYLD_PRINT_BINDINGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.split("\n");
  expect({
    dyldPrintedItsBindings: lines.some(line => line.startsWith("dyld[")),
    patchesOfTheSharedCache: lines.filter(line => line.includes("cache patch")),
    exitCode,
  }).toEqual({ dyldPrintedItsBindings: true, patchesOfTheSharedCache: [], exitCode: 0 });
});
