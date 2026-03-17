import { $, semver } from "bun";
import { expect, test } from "bun:test";
import { bunExe } from "harness";

const BUN_EXE = bunExe();

if (process.platform === "linux") {
  test("objdump -T does not include symbols from glibc > 2.26", async () => {
    const objdump = Bun.which("objdump") || Bun.which("llvm-objdump");
    if (!objdump) {
      throw new Error("objdump executable not found. Please install it.");
    }

    const output = await $`${objdump} -T ${BUN_EXE} | grep GLIBC_`.nothrow().text();
    const lines = output.split("\n");
    const errors = [];
    for (const line of lines) {
      const match = line.match(/\(GLIBC_2(.*)\)\s/);
      if (match?.[1]) {
        let version = "2." + match[1];
        if (version.startsWith("2..")) {
          version = "2." + version.slice(3);
        }
        if (semver.order(version, "2.26.0") > 0) {
          errors.push({
            symbol: line.slice(line.lastIndexOf(")") + 1).trim(),
            "glibc version": version,
          });
        }
      }
    }
    if (errors.length) {
      throw new Error(`Found glibc symbols > 2.26. This breaks Amazon Linux 2 and Vercel.

${Bun.inspect.table(errors, { colors: true })}
To fix this, add it to -Wl,--wrap=symbol in the linker flags and update workaround-missing-symbols.cpp.`);
    }
  });

  test("libatomic.so is not linked", async () => {
    const ldd = Bun.which("ldd");

    if (!ldd) {
      throw new Error("ldd executable not found. Please install it.");
    }

    const output = await $`${ldd} ${BUN_EXE}`.text();
    const lines = output.split("\n");
    const errors = [];
    for (const line of lines) {
      // libatomic
      if (line.includes("libatomic")) {
        errors.push(line);
      }
    }
    if (errors.length) {
      throw new Error(`libatomic.so is linked. This breaks Amazon Linux 2 and Vercel.

${errors.join("\n")}

To fix this, figure out which C math symbol is being used that causes it, and wrap it in workaround-missing-symbols.cpp.`);
    }
  });
}

if (process.platform === "win32") {
  // Allowlist of DLLs bun.exe may import (static or delay-load). All are
  // Windows system DLLs that ship with the OS.
  //
  // If this test fails, bun.exe has gained a dependency on a non-system DLL
  // (most commonly VCRUNTIME140.dll / api-ms-win-crt-*.dll from the dynamic
  // MSVC CRT). This causes STATUS_DLL_NOT_FOUND on machines without the
  // VC++ redistributable — bun must be fully statically linked.
  //
  // Common cause: a vendored CMake sub-build using CMP0091 NEW (implied by
  // cmake_minimum_required ≥ 3.15) without setting MSVC_RUNTIME_LIBRARY,
  // which defaults to /MD (dynamic CRT). Fix:
  //   set_property(TARGET <name> PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  // or pass -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded to the sub-build.
  const ALLOWED_DLL_IMPORTS = new Set([
    "advapi32.dll",
    "api-ms-win-core-synch-l1-2-0.dll", // forwards to kernel32; OS-provided (NOT api-ms-win-crt-*)
    "bcrypt.dll",
    "bcryptprimitives.dll",
    "crypt32.dll",
    "dbghelp.dll",
    "iphlpapi.dll",
    "kernel32.dll",
    "ntdll.dll",
    "ole32.dll",
    "oleaut32.dll",
    "shell32.dll",
    "user32.dll",
    "userenv.dll",
    "winmm.dll",
    "ws2_32.dll",
    "wsock32.dll",
  ]);

  // vcruntime140_1.dll (__CxxFrameHandler4 only) is tolerated IF delay-loaded
  // since it resolves lazily at first C++ unwind, not at process startup.
  // BuildBun.cmake sets /delayload:VCRUNTIME140_1.dll for this reason.
  // As a hard (static) import it would still break on machines without VC++ redist.
  const ALLOWED_DELAY_ONLY = new Set(["vcruntime140_1.dll"]);

  test("PE import table contains only allowlisted system DLLs", async () => {
    const readobj = Bun.which("llvm-readobj");
    if (!readobj) {
      throw new Error("llvm-readobj not found. It ships with LLVM (required to build bun).");
    }

    // --coff-imports dumps both the static import table and the delay-load table.
    //   Import {           ← static (hard dep, checked at process start)
    //     Name: KERNEL32.dll
    //   DelayImport {      ← delay-load (resolved on first call)
    //     Name: ole32.dll
    const output = await $`${readobj} --coff-imports ${BUN_EXE}`.text();

    const imports: { dll: string; kind: "static" | "delay" }[] = [];
    let currentKind: "static" | "delay" | null = null;
    for (const line of output.split("\n")) {
      if (/^Import\s*\{/.test(line)) currentKind = "static";
      else if (/^DelayImport\s*\{/.test(line)) currentKind = "delay";
      else if (currentKind) {
        const m = line.match(/^\s*Name:\s*(\S+)/);
        if (m) {
          imports.push({ dll: m[1], kind: currentKind });
          currentKind = null;
        }
      }
    }

    if (imports.length === 0) {
      throw new Error("Failed to parse imports from llvm-readobj — parser broken?\n\n" + output.slice(0, 500));
    }

    const violations = imports.filter(({ dll, kind }) => {
      const lower = dll.toLowerCase();
      if (ALLOWED_DLL_IMPORTS.has(lower)) return false;
      if (ALLOWED_DELAY_ONLY.has(lower) && kind === "delay") return false;
      return true;
    });

    if (violations.length > 0) {
      throw new Error(
        `bun.exe imports non-allowlisted DLLs. This causes STATUS_DLL_NOT_FOUND on machines without VC++ redist.\n\n` +
          Bun.inspect.table(violations, { colors: true }) +
          `\nFull import list (${imports.length}):\n` +
          imports.map(i => `  [${i.kind.padEnd(6)}] ${i.dll}`).join("\n") +
          `\n\nCommon fix: a vendored CMake sub-build is missing MSVC_RUNTIME_LIBRARY — see comment at top of this test.`,
      );
    }

    // Sanity check: we actually parsed something meaningful.
    expect(imports.some(i => i.dll.toLowerCase() === "kernel32.dll")).toBe(true);
  });
}
