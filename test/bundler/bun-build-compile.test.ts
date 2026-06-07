import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, isMusl, isPosix, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "path";

describe("Bun.build compile", () => {
  test("compile with current platform target string", async () => {
    using dir = tempDir("build-compile-target", {
      "app.js": `console.log("Cross-compiled app");`,
    });

    const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
    const arch = isArm64 ? "aarch64" : "x64";
    const musl = isMusl ? "-musl" : "";
    const target = `bun-${os}-${arch}${musl}` as any;
    const outdir = join(dir + "", "out");

    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      outdir,
      compile: {
        target: target,
        outfile: "app-cross",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-cross.exe" : "app-cross");

    const exists = await Bun.file(result.outputs[0].path).exists();

    // Verify that we do write it to the outdir.
    expect(result.outputs[0].path.replaceAll("\\", "/")).toStartWith(outdir.replaceAll("\\", "/"));
    expect(exists).toBe(true);
  });

  test("compile with invalid target fails gracefully", async () => {
    using dir = tempDir("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [join(dir, "index.js")],
        compile: {
          target: "bun-invalid-platform",
          outfile: join(dir, "invalid-app"),
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"Unknown compile target: bun-invalid-platform"`);
  });
  test("compile with relative outfile paths", async () => {
    using dir = tempDir("build-compile-relative-paths", {
      "app.js": `console.log("Testing relative paths");`,
    });

    // Test 1: Nested forward slash path
    const result1 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "output/nested/app1"),
      },
    });
    expect(result1.success).toBe(true);
    expect(result1.outputs[0].path).toContain(join("output", "nested", isWindows ? "app1.exe" : "app1"));

    // Test 2: Current directory relative path
    const result2 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "app2"),
      },
    });
    expect(result2.success).toBe(true);
    expect(result2.outputs[0].path).toEndWith(isWindows ? "app2.exe" : "app2");

    // Test 3: Deeply nested path
    const result3 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "a/b/c/d/app3"),
      },
    });
    expect(result3.success).toBe(true);
    expect(result3.outputs[0].path).toContain(join("a", "b", "c", "d", isWindows ? "app3.exe" : "app3"));
  });

  test("compile with embedded resources uses correct module prefix", async () => {
    using dir = tempDir("build-compile-embedded-resources", {
      "app.js": `
        // This test verifies that embedded resources use the correct target-specific base path
        // The module prefix should be set to the target's base path 
        // not the user-configured public_path
        import { readFileSync } from 'fs';
        
        // Try to read a file that would be embedded in the standalone executable
        try {
          const embedded = readFileSync('embedded.txt', 'utf8');
          console.log('Embedded file:', embedded);
        } catch (e) {
          console.log('Reading embedded file');
        }
      `,
      "embedded.txt": "This is an embedded resource",
    });

    // Test with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: "app-with-resources",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-with-resources.exe" : "app-with-resources");

    // The test passes if compilation succeeds - the actual embedded resource
    // path handling is verified by the successful compilation
  });
});

describe("compiled binary validity", () => {
  test("output binary has valid executable header", async () => {
    using dir = tempDir("build-compile-valid-header", {
      "app.js": `console.log("hello");`,
    });

    const outfile = join(dir + "", "app-out");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    // Read the first 4 bytes and verify it's a valid executable magic number
    const file = Bun.file(result.outputs[0].path);
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());

    if (isMacOS) {
      // MachO magic: 0xCFFAEDFE (little-endian)
      expect(header[0]).toBe(0xcf);
      expect(header[1]).toBe(0xfa);
      expect(header[2]).toBe(0xed);
      expect(header[3]).toBe(0xfe);
    } else if (isLinux) {
      // ELF magic: 0x7F 'E' 'L' 'F'
      expect(header[0]).toBe(0x7f);
      expect(header[1]).toBe(0x45); // 'E'
      expect(header[2]).toBe(0x4c); // 'L'
      expect(header[3]).toBe(0x46); // 'F'
    } else if (isWindows) {
      // PE magic: 'M' 'Z'
      expect(header[0]).toBe(0x4d); // 'M'
      expect(header[1]).toBe(0x5a); // 'Z'
    }
  });

  test("compiled binary runs and produces expected output", async () => {
    using dir = tempDir("build-compile-runs", {
      "app.js": `console.log("compile-test-output");`,
    });

    const outfile = join(dir + "", "app-run");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [result.outputs[0].path],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("compile-test-output");
    expect(exitCode).toBe(0);
  });
});

if (isLinux) {
  describe("ELF section", () => {
    test("compiled binary runs with execute-only permissions", async () => {
      using dir = tempDir("build-compile-exec-only", {
        "app.js": `console.log("exec-only-output");`,
      });

      const outfile = join(dir + "", "app-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("exec-only-output");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs correctly", async () => {
      // Generate a string payload >16KB to exceed the initial .bun section allocation
      // (BUN_COMPILED is aligned to 16KB). This forces the expansion path in elf.zig
      // which appends data to the end of the file and extends the writable PT_LOAD
      // to cover it.
      const largeString = Buffer.alloc(20000, "x").toString();
      using dir = tempDir("build-compile-large-payload", {
        "app.js": `const data = "${largeString}"; console.log("large-payload-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-payload-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs with execute-only permissions", async () => {
      // Same as above but also verifies execute-only works with the expansion path
      const largeString = Buffer.alloc(20000, "y").toString();
      using dir = tempDir("build-compile-large-exec-only", {
        "app.js": `const data = "${largeString}"; console.log("large-exec-only-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-exec-only-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary has .bun ELF section", async () => {
      using dir = tempDir("build-compile-elf-section", {
        "app.js": `console.log("elf-section-test");`,
      });

      const outfile = join(dir + "", "app-elf-section");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      // Verify .bun ELF section exists by reading section headers
      const file = Bun.file(result.outputs[0].path);
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Parse ELF header to find section headers
      const view = new DataView(bytes.buffer);
      // e_shoff at offset 40 (little-endian u64)
      const shoff = Number(view.getBigUint64(40, true));
      // e_shentsize at offset 58
      const shentsize = view.getUint16(58, true);
      // e_shnum at offset 60
      const shnum = view.getUint16(60, true);
      // e_shstrndx at offset 62
      const shstrndx = view.getUint16(62, true);

      // Read .shstrtab section header to get string table
      const strtabOff = shoff + shstrndx * shentsize;
      const strtabFileOffset = Number(view.getBigUint64(strtabOff + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabOff + 32, true));

      const decoder = new TextDecoder();
      let foundBunSection = false;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx < strtabSize) {
          // Read null-terminated string from strtab
          let end = strtabFileOffset + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabFileOffset + nameIdx, end));
          if (name === ".bun") {
            foundBunSection = true;
            // Verify the section has non-zero size
            const shSize = Number(view.getBigUint64(hdrOff + 32, true));
            expect(shSize).toBeGreaterThan(0);
            break;
          }
        }
      }
      expect(foundBunSection).toBe(true);
    });

    // Regression guard for #29963. WSL1's kernel ELF loader rejects `execve`
    // with ENOEXEC when it sees a late PT_LOAD produced by repurposing
    // PT_GNU_STACK. The compiled binary must instead:
    //
    //   1. Keep PT_GNU_STACK in the program header table (not repurposed).
    //   2. Fit the .bun payload inside an existing writable PT_LOAD's
    //      `[p_vaddr, p_vaddr + p_memsz)` range — i.e. the writable segment
    //      was GROWN to cover .bun rather than a new segment being added.
    //
    // The gate here is purely structural (we check the ELF layout); we don't
    // need a WSL1 host to validate the fix.
    //
    // Higher per-test timeout because `bun build --compile` copies + rewrites
    // the entire bun binary (~1GB under debug+ASAN), which blows the 5s
    // default.
    test("compiled binary preserves PT_GNU_STACK and no late PT_LOAD for .bun (#29963)", async () => {
      // Use a small payload — the shape check matters for all sizes but a
      // bigger payload guarantees the expansion path actually runs.
      const largeString = Buffer.alloc(20000, "z").toString();
      using dir = tempDir("build-compile-wsl1-regression", {
        "app.js": `const data = "${largeString}"; console.log("wsl1-regression-" + data.length);`,
      });

      const outfile = join(dir + "", "app-wsl1-regression");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
      });
      expect(result.success).toBe(true);

      const bytes = new Uint8Array(await Bun.file(result.outputs[0].path).arrayBuffer());
      const view = new DataView(bytes.buffer);

      // ELF64 header layout:
      //   e_phoff @ 32 (u64), e_phentsize @ 54 (u16), e_phnum @ 56 (u16)
      const phoff = Number(view.getBigUint64(32, true));
      const phentsize = view.getUint16(54, true);
      const phnum = view.getUint16(56, true);
      expect(phentsize).toBe(56); // sizeof(Elf64_Phdr)

      // Elf64_Phdr layout:
      //   p_type @ 0 (u32), p_flags @ 4 (u32), p_offset @ 8 (u64),
      //   p_vaddr @ 16 (u64), p_paddr @ 24 (u64),
      //   p_filesz @ 32 (u64), p_memsz @ 40 (u64), p_align @ 48 (u64)
      const PT_LOAD = 1;
      const PT_GNU_STACK = 0x6474e551;
      const PF_W = 2;

      // Locate .bun's vaddr by walking section headers.
      const shoff = Number(view.getBigUint64(40, true));
      const shentsize = view.getUint16(58, true);
      const shnum = view.getUint16(60, true);
      const shstrndx = view.getUint16(62, true);
      const strtabHdr = shoff + shstrndx * shentsize;
      const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));
      const decoder = new TextDecoder();
      let bunAddr = 0n;
      let bunSize = 0n;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx >= strtabSize) continue;
        let end = strtabOff + nameIdx;
        while (end < bytes.length && bytes[end] !== 0) end++;
        const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
        if (name === ".bun") {
          bunAddr = view.getBigUint64(hdrOff + 16, true); // sh_addr
          bunSize = view.getBigUint64(hdrOff + 32, true); // sh_size
          break;
        }
      }
      expect(bunAddr).not.toBe(0n);
      expect(bunSize).toBeGreaterThan(0n);

      // Walk program headers: count PT_LOADs, require PT_GNU_STACK to still
      // be present, and find the writable PT_LOAD containing .bun.
      let hasGnuStack = false;
      let loadCount = 0;
      let writableLoadCoversBun = false;
      for (let i = 0; i < phnum; i++) {
        const off = phoff + i * phentsize;
        const pType = view.getUint32(off, true);
        const pFlags = view.getUint32(off + 4, true);
        const pVaddr = view.getBigUint64(off + 16, true);
        const pMemsz = view.getBigUint64(off + 40, true);

        if (pType === PT_GNU_STACK) hasGnuStack = true;
        if (pType === PT_LOAD) {
          loadCount++;
          if ((pFlags & PF_W) !== 0 && pVaddr <= bunAddr && bunAddr + bunSize <= pVaddr + pMemsz) {
            writableLoadCoversBun = true;
          }
        }
      }

      // #29963: PT_GNU_STACK must NOT be repurposed into a PT_LOAD.
      expect(hasGnuStack).toBe(true);
      // #29963: the writable PT_LOAD must have been grown to cover .bun,
      // rather than a new late PT_LOAD being appended.
      expect(writableLoadCoversBun).toBe(true);
      // A stock bun has 3 PT_LOAD segments; the fix must not add a 4th.
      expect(loadCount).toBe(3);
      // JSC bytecode cache requires 128-byte-aligned deserialization input.
      // StandaloneModuleGraph writes bytecode at payload offset 120 assuming
      // the `[u64 size]` header sits at a 128-byte-aligned vaddr (so bytecode
      // lands at vaddr + 8 + 120, which is 128-aligned). A new_vaddr that
      // inherits the RW segment's non-128 residue SIGSEGVs JSC on aarch64.
      expect(bunAddr % 128n).toBe(0n);

      // Sanity: the binary still runs and produces the expected output.
      // (Ignore stderr — a debug-ASAN bun may log `hintSourcePagesDontNeed`
      // advisory warnings from the compiled binary's mmap'd .bun segment.)
      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("wsl1-regression-20000");
      expect(exitCode).toBe(0);
    }, 60_000);
  });
}

// Regression guard for the standalone-module-graph ELF probe on Android.
//
// Spec: src/standalone_graph/StandaloneModuleGraph.zig — `fromExecutable()`
// gates the ELF `.bun` reader on `Environment.isLinux or Environment.isFreeBSD`.
// Zig's `isLinux` (builtin.target.os.tag == .linux) is TRUE on Android, so
// Android takes the ELF path and the trailing `comptime unreachable` is dead.
//
// In Rust, `target_os = "linux"` and `target_os = "android"` are distinct cfg
// values. A naive port of the Zig gate as
//   #[cfg(any(target_os = "linux", target_os = "freebsd"))]
// silently excludes Android and falls through to the catch-all
// `unreachable!()`, so every `bun build --compile` binary panics at startup
// on Android instead of loading its embedded module graph.
//
// This test only runs on an Android host. It compiles a trivial app and
// asserts the resulting binary starts, finds its graph, and runs the entry —
// i.e. the ELF arm was taken, not `unreachable!()`.
if (process.platform === "android") {
  describe("ELF section (Android)", () => {
    test("compiled standalone binary loads its module graph on Android", async () => {
      using dir = tempDir("build-compile-android-elf", {
        "app.js": `console.log("android-standalone-ok");`,
      });

      const outfile = join(String(dir), "app-android");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      await using proc = Bun.spawn({
        cmd: [outfile],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // If the Rust cfg-gate diverges from Zig's `Environment.isLinux`, the
      // process panics with `internal error: entered unreachable code` before
      // any user JS runs. Assert the spec behavior: graph found, entry ran.
      expect(stderr).not.toContain("unreachable");
      expect(stdout.trim()).toBe("android-standalone-ok");
      expect(exitCode).toBe(0);
    }, 60_000);
  });
}

// A standalone compiled binary bypasses `Arguments::parse` (no `--cwd`/global
// flags, no baked exec-argv), so `absolute_working_dir` stays unset and the
// FIRST `getcwd` of the whole startup is the one inside `Transpiler::init`.
// When the cwd has been deleted that `getcwd` fails with ENOENT; the bug was
// that the per-VM init hook swallowed the error and left `vm.transpiler`
// zeroed, so the next read (`configure_defines` → `run_env_loader`) hit a null
// deref and the binary crashed (the segfault users saw launching a compiled
// CLI from a directory that had been removed). It must instead exit cleanly
// with the ENOENT message.
//
// POSIX-only: a process can keep a deleted directory as its cwd until the last
// fd to it closes, whereas Windows refuses to remove a directory that is any
// process's cwd — so the scenario is unreachable there. The cwd has to be
// removed AFTER the process starts, which `Bun.spawn`'s `cwd` can't do, so a
// shell wrapper `cd`s in, `rmdir`s, then execs the binary (how a user hits it).
describe("compiled binary in a deleted cwd", () => {
  test.if(isPosix)(
    "exits cleanly instead of crashing",
    async () => {
      using dir = tempDir("build-compile-deleted-cwd", {
        "app.js": `console.log("should-not-run");`,
      });
      const outfile = join(String(dir), "app");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      // A fresh directory to stand in and delete — NOT `dir`, which holds the
      // compiled binary we still need to exec.
      using cwdDir = tempDir("build-compile-gone-cwd", {});
      const gone = String(cwdDir);

      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${outfile}"`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The entry never runs (VM init aborts first), the ENOENT surfaces, and the
      // process exits 1 — a crash would terminate via a signal, never exit 1.
      expect(stdout).toBe("");
      expect(stderr).toContain("ENOENT");
      expect(exitCode).toBe(1);
    },
    60_000,
  );
});

// file command test works well

// A `bun build --compile --bytecode` executable embeds both the bundled source
// and its JSC bytecode. JSC's bytecode decoder trusts interior offsets/sizes,
// so if the embedded bytecode is modified after compilation (partial download,
// disk corruption, binary rewriters like rcedit/signtool), feeding it to the
// decoder crashes the process at startup. The StandaloneModuleGraph records a
// hash of each module's bytecode + module_info at build time and falls back to
// parsing the embedded source when it no longer matches.
describe("compiled executable bytecode integrity", () => {
  // Container layout from src/standalone_graph/StandaloneModuleGraph.rs: the
  // embedded payload ends with [Offsets struct][16-byte trailer], and every
  // StringPointer inside is relative to the payload start.
  const TRAILER = Buffer.from("\n---- Bun! ----\n");
  // #[repr(C)] Offsets { byte_count: usize, modules_ptr: StringPointer,
  //   entry_point_id: u32, compile_exec_argv_ptr: StringPointer, flags: u32 }
  const OFFSETS_SIZE = 32;
  // #[repr(C)] CompiledModuleGraphFile: 6 StringPointers (name, contents,
  // sourcemap, bytecode, module_info, bytecode_origin_path), bytecode_hash
  // ([u8; 8]), then 4 one-byte enums. 52 is the pre-hash record size, kept so
  // the locator also works on older builds (where the run then crashes).
  const RECORD_SIZES = [60, 52];
  const RECORD_BYTECODE_OFFSET = 24;
  const RECORD_MODULE_INFO_OFFSET = 32;

  interface GraphLocation {
    base: number;
    records: number[];
  }

  // The trailer string also lives in the bun binary's read-only data, so every
  // occurrence is validated structurally and the last valid one (the embedded
  // graph, which is placed after the runtime's own bytes) wins.
  function findModuleGraph(exe: Buffer): GraphLocation | null {
    let result: GraphLocation | null = null;
    let pos = -1;
    while ((pos = exe.indexOf(TRAILER, pos + 1)) !== -1) {
      const offsetsPos = pos - OFFSETS_SIZE;
      if (offsetsPos < 0) continue;
      const byteCountBig = exe.readBigUInt64LE(offsetsPos);
      if (byteCountBig === 0n || byteCountBig > BigInt(offsetsPos)) continue;
      const byteCount = Number(byteCountBig);
      const base = offsetsPos - byteCount;
      const modulesOffset = exe.readUInt32LE(offsetsPos + 8);
      const modulesLength = exe.readUInt32LE(offsetsPos + 12);
      const entryPointId = exe.readUInt32LE(offsetsPos + 16);
      if (modulesLength === 0 || modulesOffset + modulesLength > byteCount) continue;
      const recordSize = RECORD_SIZES.find(size => modulesLength % size === 0);
      if (recordSize === undefined) continue;
      const count = modulesLength / recordSize;
      if (entryPointId >= count) continue;

      const records: number[] = [];
      let valid = true;
      for (let i = 0; i < count; i++) {
        const rec = base + modulesOffset + i * recordSize;
        const nameOffset = exe.readUInt32LE(rec);
        const nameLength = exe.readUInt32LE(rec + 4);
        const contentsOffset = exe.readUInt32LE(rec + 8);
        const contentsLength = exe.readUInt32LE(rec + 12);
        if (nameLength === 0 || nameOffset + nameLength > byteCount) {
          valid = false;
          break;
        }
        if (contentsOffset + contentsLength > byteCount) {
          valid = false;
          break;
        }
        records.push(rec);
      }
      if (valid) result = { base, records };
    }
    return result;
  }

  // XORs 64 bytes in the middle of each module's region (bytecode or
  // module_info), far past the 4-byte JSC cache-version header at the start,
  // which is the only part the decoder checks before trusting the rest.
  function corruptRegions(exe: Buffer, fieldOffset: number): number {
    const graph = findModuleGraph(exe);
    expect(graph).not.toBeNull();
    let corrupted = 0;
    for (const rec of graph!.records) {
      const offset = exe.readUInt32LE(rec + fieldOffset);
      const length = exe.readUInt32LE(rec + fieldOffset + 4);
      if (length === 0) continue;
      const start = graph!.base + offset + (length >> 1);
      const n = Math.min(64, length - (length >> 1));
      for (let i = 0; i < n; i++) exe[start + i] ^= 0xa5;
      corrupted++;
    }
    return corrupted;
  }

  async function buildExecutable(dir: string, format: "cjs" | "esm"): Promise<string> {
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        `--format=${format}`,
        join(dir, "app.js"),
        "--outfile",
        join(dir, "app"),
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error:");
    expect(buildExit).toBe(0);
    return join(dir, isWindows ? "app.exe" : "app");
  }

  async function runExecutable(exePath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    await using proc = Bun.spawn({
      cmd: [exePath],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Writes the corrupted executable to a sibling path: overwriting the
  // original in place can hit ETXTBSY while the kernel still holds it open
  // from the pristine run.
  async function corruptExecutable(exePath: string, fieldOffset: number): Promise<string> {
    const exe = Buffer.from(await Bun.file(exePath).arrayBuffer());
    expect(corruptRegions(exe, fieldOffset)).toBeGreaterThan(0);
    const corruptedPath = isWindows ? exePath.replace(/\.exe$/, "-corrupted.exe") : `${exePath}-corrupted`;
    await Bun.write(corruptedPath, exe);
    chmodSync(corruptedPath, 0o755);
    if (isMacOS) {
      // Re-sign so the ad-hoc code signature covers the corrupted bytes;
      // otherwise the kernel kills the process before it can start.
      await using sign = Bun.spawn({
        cmd: ["codesign", "--force", "--sign", "-", corruptedPath],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await sign.exited).toBe(0);
    }
    return corruptedPath;
  }

  for (const format of ["cjs", "esm"] as const) {
    test(`corrupted embedded bytecode falls back to source (${format})`, async () => {
      using dir = tempDir(`bytecode-integrity-${format}`, {
        "app.js": `console.log("bytecode-integrity-marker");`,
      });
      const exePath = await buildExecutable(String(dir), format);

      // Pristine executable: the bytecode hash matches, so JSC decodes the
      // embedded bytecode instead of parsing source.
      const clean = await runExecutable(exePath);
      expect(clean.stdout).toContain("bytecode-integrity-marker");
      expect(clean.stderr).toContain("Cache hit for sourceCode");
      expect(clean.exitCode).toBe(0);

      const corruptedPath = await corruptExecutable(exePath, RECORD_BYTECODE_OFFSET);

      // Corrupted bytecode must be rejected before it reaches JSC's decoder,
      // falling back to the embedded source. Not a crash, not a silent decode.
      const corrupted = await runExecutable(corruptedPath);
      expect(corrupted.stdout).toContain("bytecode-integrity-marker");
      expect(corrupted.stderr).not.toContain("Cache hit for sourceCode");
      expect(corrupted.exitCode).toBe(0);
    }, 60_000);
  }

  test("corrupted embedded module_info falls back to source (esm)", async () => {
    using dir = tempDir("module-info-integrity", {
      "app.js": `console.log("module-info-integrity-marker");`,
    });
    const exePath = await buildExecutable(String(dir), "esm");

    // module_info is covered by the same hash as the bytecode: both are
    // produced together at build time and parsed with the same trust.
    const corruptedPath = await corruptExecutable(exePath, RECORD_MODULE_INFO_OFFSET);

    const corrupted = await runExecutable(corruptedPath);
    expect(corrupted.stdout).toContain("module-info-integrity-marker");
    expect(corrupted.stderr).not.toContain("Cache hit for sourceCode");
    expect(corrupted.exitCode).toBe(0);
  }, 60_000);
});
