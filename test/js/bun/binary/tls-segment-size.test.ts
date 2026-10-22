// Guards against regressing the Windows `.tls` section bloat fixed when
// ~50 `threadlocal var x: bun.PathBuffer` were moved behind
// `bun.ThreadlocalBuffers`.
//
// PE/COFF has no TLS-BSS, so on Windows each of those buffers (96 KB
// apiece there) used to be written into bun.exe as raw zeros — ~5 MB of
// them — and copied into every thread's TLS block at creation. On ELF
// the same declarations land in `.tbss` which costs no disk space, but
// the in-memory template (PT_TLS `MemSiz`) still scaled with them:
// ~340 KB per thread before, ~84 KB after.
//
// This test reads the TLS template size out of the running binary's
// headers and asserts it stays under a ceiling well below the old value,
// so a future reintroduction of large static threadlocals is caught on
// every platform rather than only showing up as a Windows size bump.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isLinux, isWindows, preadExact, readElf64ProgramHeaders } from "harness";
import { closeSync, openSync } from "node:fs";

/**
 * ELF: size of the PT_TLS segment's in-memory template (p_memsz). This is
 * the number of bytes the loader reserves and initialises per thread for
 * static TLS — i.e. the sum of all `threadlocal` storage reachable from
 * the main image.
 */
function elfTlsMemSize(path: string): number {
  const tls = readElf64ProgramHeaders(path).find(ph => ph.type === 7 /* PT_TLS */);
  return tls ? Number(tls.memsz) : 0;
}

/**
 * PE: size of the `.tls` section's VirtualSize. Unlike ELF this is also
 * the on-disk size (PE has no TLS-BSS), so it directly measures the
 * bytes shipped in bun.exe.
 */
function peTlsVirtualSize(path: string): number {
  const fd = openSync(path, "r");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const peOff = dos.readUInt32LE(60);
    const sig = preadExact(fd, peOff, 4);
    if (sig.readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");

    const coff = preadExact(fd, peOff + 4, 20);
    const numberOfSections = coff.readUInt16LE(2);
    const sizeOfOptionalHeader = coff.readUInt16LE(16);
    const sectOff = peOff + 4 + 20 + sizeOfOptionalHeader;

    for (let i = 0; i < numberOfSections; i++) {
      const sh = preadExact(fd, sectOff + i * 40, 40);
      // Section name is 8 bytes, null-padded.
      const name = sh.subarray(0, 8).toString("latin1").replace(/\0+$/, "");
      if (name === ".tls") {
        return sh.readUInt32LE(8); // VirtualSize
      }
    }
    return 0;
  } finally {
    closeSync(fd);
  }
}

describe("static TLS footprint", () => {
  // Ceiling chosen to sit well between the post-fix size (~82 KB on Linux
  // debug+ASAN, a few KB on Windows release) and the pre-fix size (~340 KB
  // on Linux, ~5 MB on Windows). Generous enough that small additions of
  // pointer-sized threadlocals don't trip it, but any PathBuffer-sized
  // static threadlocal will.
  const CEILING = 192 * 1024;

  test.skipIf(!(isLinux || isFreeBSD))("ELF PT_TLS MemSiz stays under the ceiling", () => {
    const size = elfTlsMemSize(process.execPath);
    console.log(`PT_TLS p_memsz = ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CEILING);
  });

  test.skipIf(!isWindows)("PE .tls VirtualSize stays under the ceiling", () => {
    const size = peTlsVirtualSize(process.execPath);
    console.log(`.tls VirtualSize = ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CEILING);
  });
});

/** PE32+: SizeOfStackReserve and SizeOfStackCommit of the optional header. */
function peStackSizes(path: string): { reserve: number; commit: number } {
  const fd = openSync(path, "r");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const peOff = dos.readUInt32LE(60);
    if (preadExact(fd, peOff, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");
    const optional = preadExact(fd, peOff + 4 + 20, 96);
    if (optional.readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
    return { reserve: Number(optional.readBigUInt64LE(72)), commit: Number(optional.readBigUInt64LE(80)) };
  } finally {
    closeSync(fd);
  }
}

// The stack commit in the PE header is not the main thread's alone. Windows charges it against the system commit
// limit when a thread starts, for every thread that passes no commit size of its own (WTF's, Rust std's, mimalloc's,
// the ones the OS adds), and does not start a thread it cannot charge it for. bun.exe had 2 MB there: a process near
// the commit limit ended when JSC could not start a GC helper thread, which it does again after every idle period.
describe.skipIf(!isWindows)("thread stacks", () => {
  test("the PE header reserves 18 MB of stack and commits one page of it", () => {
    expect(peStackSizes(bunExe())).toEqual({ reserve: 0x1200000, commit: 0x1000 });
  });

  test("a thread commits its stack as it touches it, not when it starts", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { dlopen } = require("bun:ffi");
          const { symbols: kernel32 } = dlopen("kernel32.dll", {
            GetModuleHandleA: { args: ["ptr"], returns: "ptr" },
            GetProcAddress: { args: ["ptr", "ptr"], returns: "ptr" },
            CreateThread: { args: ["ptr", "u64", "ptr", "ptr", "u32", "ptr"], returns: "u64" },
          });
          const Sleep = kernel32.GetProcAddress(
            kernel32.GetModuleHandleA(Buffer.from("kernel32.dll\\0")),
            Buffer.from("Sleep\\0"),
          );
          const INFINITE = 0xffffffff;
          const STACK_SIZE_PARAM_IS_A_RESERVATION = 0x10000;
          const threads = 32;
          // Bun.unsafe.memoryFootprint() is the process's commit charge on Windows (PrivateUsage).
          function commitPerThread(stackSize, flags) {
            const before = Bun.unsafe.memoryFootprint();
            for (let i = 0; i < threads; i++)
              if (!kernel32.CreateThread(null, stackSize, Sleep, INFINITE, flags, null))
                throw new Error("CreateThread failed");
            return Math.round((Bun.unsafe.memoryFootprint() - before) / threads);
          }
          console.log(JSON.stringify({
            // How WTF, mimalloc and the OS start a thread: both sizes from the header.
            headerSizes: commitPerThread(0, 0),
            // How Rust std starts one: a reserve of its own, the commit from the header.
            ownReserve: commitPerThread(0x1200000, STACK_SIZE_PARAM_IS_A_RESERVATION),
          }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const commit = JSON.parse(stdout);
    console.log(
      `commit per thread start: ${commit.headerSizes} bytes (header sizes), ${commit.ownReserve} (own reserve)`,
    );
    // With 2 MB in the header each start took 2.1 MB. What is left is the TEB, the TLS block and the first stack
    // pages: 28 to 57 KB on the x64 and arm64 test machines.
    expect(commit.headerSizes).toBeLessThan(256 * 1024);
    expect(commit.ownReserve).toBeLessThan(256 * 1024);
    expect(exitCode).toBe(0);
  });
});
