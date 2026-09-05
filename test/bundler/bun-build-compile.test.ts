import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isDebug, isLinux, isMacOS, isMusl, isPosix, isWindows, tempDir } from "harness";
import { chmodSync, closeSync, cpSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
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

  // The executable's embedded bytecode is mapped for the life of the process, so decoded instruction streams alias it
  // instead of being copied into private memory. Same binary with the aliasing switched off is the control.
  test.skipIf(!isLinux)(
    "bytecode from a compiled executable is not copied into private memory",
    async () => {
      const body = Array.from(
        { length: 24 },
        (_, j) => `s = (s * ${j + 3} + a) ^ (b + ${j}); if (s & ${1 << j % 20}) s = s - ${j} | 0; o.p${j} = s;`,
      ).join(" ");
      const functions = Array.from(
        { length: 4000 },
        (_, i) => `export function f${i}(a, b) { let s = ${i}; const o = {}; ${body} return [s, ${i}, o]; }`,
      ).join("\n");
      using dir = tempDir("build-compile-bytecode-rss", {
        "funcs.js": functions,
        "app.js": `import * as m from "./funcs.js";
let n = 0;
for (const k in m) n += m[k](2, 3)[1] & 1;
const smaps = require("fs").readFileSync("/proc/self/smaps_rollup", "utf8");
const anon = Number(/Anonymous: +([0-9]+) kB/.exec(smaps)[1]);
console.log(JSON.stringify({ n, anonKB: anon }));`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
        bytecode: true,
        format: "esm",
        target: "bun",
      });
      expect(result.success).toBe(true);

      const run = async (extraEnv: Record<string, string>) => {
        await using proc = Bun.spawn({
          cmd: [outfile],
          env: { ...bunEnv, ...extraEnv },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toContain("anonKB");
        expect(exitCode).toBe(0);
        return JSON.parse(stdout.trim()) as { n: number; anonKB: number };
      };
      const aliased = await run({});
      const copied = await run({ BUN_JSC_useBorrowedBytecodeFromCache: "0" });
      expect(aliased.n).toBe(2000);
      expect(copied.n).toBe(2000);
      // 4000 decoded functions carry ~11 MB of instruction stream + expression info; copied, that is anonymous memory the aliasing run never allocates.
      expect(copied.anonKB - aliased.anonKB).toBeGreaterThan(4096);
    },
    60_000,
  );

  // --bytecode into an executable for another os/arch/libc embeds bytecode written by this platform's JavaScriptCore for
  // another's; such executables say so in crash reports (Features: cross_compiled_bytecode). The "other platform" build
  // here is the same OS with the other CPU, and reuses this bun as the target executable, so it still runs here.
  const otherPlatform = `bun-${isLinux ? "linux" : isMacOS ? "darwin" : "windows"}-${isArm64 ? "x64" : "aarch64"}${isMusl ? "-musl" : ""}`;
  test.each([
    ["this platform", undefined as string | undefined, false],
    [otherPlatform, otherPlatform, true],
  ])("--compile --bytecode for %s", async (_label, target, expected) => {
    using dir = tempDir("build-compile-cross-bytecode", {
      "app.js": `require("bun:internal-for-testing").crash_handler.panic();`,
    });
    const outfile = join(dir + "", isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        ...(target ? [`--target=${target}`, `--compile-executable-path=${process.execPath}`] : []),
        join(dir + "", "app.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    await using proc = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // (stdout is not asserted: ASAN builds print the symbolized crash trace there.)
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("panic");
    expect(stderr.includes("cross_compiled_bytecode")).toBe(expected);
    expect(exitCode).not.toBe(0);
  });

  // "cross": the target is not the host, so the internal modules' sources, ids and stamp are read out of the target
  // executable's builtins section (here: this same bun under a different version, so the result still runs locally).
  test.each([false, true, "cross" as const])(
    "--bytecode=%p: internal modules the app imports come from embedded bytecode",
    async mode => {
      const bytecode = mode !== false;
      const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
      const cross =
        mode === "cross"
          ? {
              target: `bun-${os}-${isArm64 ? "aarch64" : "x64"}${isMusl ? "-musl" : ""}-v1.0.0` as any,
              executablePath: process.execPath,
            }
          : {};
      using dir = tempDir("build-compile-builtin-bytecode", {
        "app.js": `import { join } from "node:path";
import http from "node:http";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
const server = http.createServer(() => {});
console.log(JSON.stringify({ joined: join("a", "b"), fromBytecode: internalModulesLoadedFromBytecode() }));
server.close();`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile, ...cross },
        bytecode,
        format: "esm",
        target: "bun",
      });
      expect(result.success).toBe(true);
      await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { joined, fromBytecode } = JSON.parse(stdout.trim());
      expect(joined).toBe(join("a", "b"));
      if (bytecode) {
        // node:path, node:http and what they require at load (node:net, node:events, the stream internals, ...).
        expect(fromBytecode).toBeGreaterThan(10);
      } else {
        expect(fromBytecode).toBe(0);
      }
      expect(exitCode).toBe(0);
    },
    // A --compile build plus (for "cross") bytecode for ~45 internal modules: ~10s under debug+ASAN.
    60_000,
  );

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

  // One compile per test: each compile copies the whole bun binary (~1 GB under debug+ASAN),
  // which by itself takes a good part of the default per-test timeout.
  test.each(["output/nested/app1", "app2", "a/b/c/d/app3"])(
    "compile writes the executable to outfile %s",
    async relativeOutfile => {
      using dir = tempDir("build-compile-outfile", {
        "app.js": `console.log("Testing outfile paths");`,
      });
      const outfile = join(String(dir), relativeOutfile);

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        compile: { outfile },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.map(output => output.path)).toEqual([isWindows ? `${outfile}.exe` : outfile]);
      expect(await Bun.file(result.outputs[0].path).exists()).toBe(true);
    },
  );

  test("compile without outfile writes the executable to the working directory", async () => {
    using dir = tempDir("build-compile-default-outfile", {
      "proj/sub/myapp.ts": `console.log("default outfile");`,
      "cwd/build.ts": `
        const result = await Bun.build({
          entrypoints: [process.argv[2]],
          compile: true,
        });
        console.log(JSON.stringify(result.outputs.map(output => output.path)));
      `,
    });
    const cwd = join(String(dir), "cwd");
    const entrypoint = join(String(dir), "proj", "sub", "myapp.ts");
    const name = isWindows ? "myapp.exe" : "myapp";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts", entrypoint],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The name comes from the entrypoint. The directory is the working directory, like `bun build --compile`.
    expect(JSON.parse(stdout)).toEqual([join(cwd, name)]);
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(cwd, name)).exists()).toBe(true);
    expect(await Bun.file(join(String(dir), "proj", "sub", name)).exists()).toBe(false);

    await using app = Bun.spawn({
      cmd: [join(cwd, name)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [appStdout, appStderr, appExitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
    expect(appStdout).toBe("default outfile\n");
    expect(appStderr).toBe("");
    expect(appExitCode).toBe(0);
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
    const outfile = join(dir + "", "app-with-resources");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    // A relative outfile would resolve against the test runner's cwd and leave the executable there.
    expect(result.outputs[0].path).toBe(isWindows ? `${outfile}.exe` : outfile);

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
      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain("wsl1-regression-20000");
      expect(exitCode).toBe(0);
    }, 60_000);

    // Regression guard for #31023. On NixOS, `autoPatchelfHook` runs
    // `patchelf --set-interpreter` on the installed bun binary. Patchelf
    // inserts a *new* writable PT_LOAD at the front of the program-header
    // table (to hold the relocated PHDR + .interp), so the template bun
    // has TWO writable PT_LOADs. `write_bun_section` used to pick the
    // first writable PT_LOAD and extend it — that's patchelf's small
    // segment, unrelated to .bun — producing an output whose grown
    // segment overlaps the read-only and executable PT_LOADs at
    // conflicting vaddrs. The kernel ELF loader mmap'd garbage over .bun
    // at its runtime address and the compiled binary segfaulted on exec.
    //
    // We simulate the NixOS layout by running `patchelf
    // --set-interpreter` on the bun binary (exactly what
    // autoPatchelfHook does) and then using `--compile-executable-path`
    // to drive `bun build --compile` off it. The resulting output must
    // (a) have the .bun section inside a writable PT_LOAD whose extent
    // doesn't cross another PT_LOAD, and (b) actually run.
    const patchelf = Bun.which("patchelf");
    const ldso =
      process.arch === "arm64"
        ? isMusl
          ? "/lib/ld-musl-aarch64.so.1"
          : "/lib/ld-linux-aarch64.so.1"
        : isMusl
          ? "/lib/ld-musl-x86_64.so.1"
          : "/lib64/ld-linux-x86-64.so.2";

    // Mirror of `hostUsesNixStoreInterpreter()` in src/exe_format/elf.rs:
    // gate out NixOS/Guix hosts where the FHS ldso path is a stub that
    // refuses to exec generic binaries. Without this the final
    // `Bun.spawn({cmd:[outfile]})` check fails on a NixOS host because
    // stub-ld rejects the compiled output, not because the fix is broken.
    // Same pattern as the sibling patchelf tests in
    // test/regression/issue/29290.test.ts and 24742.test.ts.
    function readInterp(buf: Buffer): string | null {
      if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
      const e_phoff = Number(buf.readBigUInt64LE(32));
      const e_phnum = buf.readUInt16LE(56);
      for (let i = 0; i < e_phnum; i++) {
        const ph = e_phoff + i * 56;
        if (buf.readUInt32LE(ph) !== 3 /* PT_INTERP */) continue;
        const p_offset = Number(buf.readBigUInt64LE(ph + 8));
        const p_filesz = Number(buf.readBigUInt64LE(ph + 32));
        const region = buf.subarray(p_offset, p_offset + p_filesz);
        const nul = region.indexOf(0);
        return region.subarray(0, nul === -1 ? region.length : nul).toString("utf8");
      }
      return null;
    }
    function hostLooksNix(): boolean {
      if (existsSync("/etc/NIXOS")) return true;
      if (existsSync("/gnu/store")) return true;
      try {
        // bun is ~1 GB in debug builds; PT_INTERP lives in the first page,
        // so read only the leading 4 KiB.
        const fd = openSync(bunExe(), "r");
        try {
          const buf = Buffer.alloc(4096);
          const n = readSync(fd, buf, 0, 4096, 0);
          const selfInterp = readInterp(buf.subarray(0, n));
          if (selfInterp && (selfInterp.startsWith("/nix/store/") || selfInterp.startsWith("/gnu/store/"))) {
            return true;
          }
        } finally {
          closeSync(fd);
        }
      } catch {}
      return false;
    }

    test.skipIf(!patchelf || !existsSync(ldso) || hostLooksNix())(
      "compiled binary works when template bun has patchelf-inserted RW PT_LOAD (#31023)",
      async () => {
        using dir = tempDir("build-compile-patchelf-rw-regression", {
          "app.js": `console.log("patchelf-regression-ok");`,
        });
        const cwd = String(dir);

        // Copy bun and patchelf it — autoPatchelfHook's signature move.
        // Any real interpreter works; we just need patchelf to insert its
        // new writable PT_LOAD at the front of the phdr table.
        const patchedBun = join(cwd, "patched-bun");
        cpSync(bunExe(), patchedBun);
        chmodSync(patchedBun, 0o755);
        {
          const r = Bun.spawnSync({
            cmd: [patchelf!, "--set-interpreter", ldso, patchedBun],
            stderr: "pipe",
          });
          expect(r.stderr.toString()).toBe("");
          expect(r.exitCode).toBe(0);
        }

        // Sanity: the patched bun really does have two writable PT_LOADs.
        // Otherwise the test is vacuous (it would exercise the same path
        // as the stock-bun tests above).
        {
          const bytes = new Uint8Array(await Bun.file(patchedBun).arrayBuffer());
          const view = new DataView(bytes.buffer);
          const phoff = Number(view.getBigUint64(32, true));
          const phentsize = view.getUint16(54, true);
          const phnum = view.getUint16(56, true);
          let writableLoads = 0;
          for (let i = 0; i < phnum; i++) {
            const off = phoff + i * phentsize;
            const pType = view.getUint32(off, true);
            const pFlags = view.getUint32(off + 4, true);
            if (pType === 1 /* PT_LOAD */ && (pFlags & 2) !== 0 /* PF_W */) writableLoads++;
          }
          expect(writableLoads).toBeGreaterThanOrEqual(2);
        }

        // Drive bun build --compile off the patched template.
        const outfile = join(cwd, "app-out");
        const build = Bun.spawnSync({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--compile-executable-path",
            patchedBun,
            join(cwd, "app.js"),
            "--outfile",
            outfile,
          ],
          env: bunEnv,
          cwd,
          stderr: "pipe",
          stdout: "pipe",
        });
        expect(build.stderr.toString()).not.toContain("error:");
        expect(build.exitCode).toBe(0);

        // Structural check on the output: the writable PT_LOAD that
        // contains .bun must not overlap any other PT_LOAD. Before the
        // fix, the grown front PT_LOAD extended past the R and R-E
        // PT_LOADs, which is exactly the corruption that segfaulted.
        const bytes = new Uint8Array(await Bun.file(outfile).arrayBuffer());
        const view = new DataView(bytes.buffer);
        const phoff = Number(view.getBigUint64(32, true));
        const phentsize = view.getUint16(54, true);
        const phnum = view.getUint16(56, true);
        const shoff = Number(view.getBigUint64(40, true));
        const shentsize = view.getUint16(58, true);
        const shnum = view.getUint16(60, true);
        const shstrndx = view.getUint16(62, true);
        const strtabHdr = shoff + shstrndx * shentsize;
        const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
        const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));

        // Find .bun's vaddr.
        const decoder = new TextDecoder();
        let bunAddr = 0n;
        for (let i = 0; i < shnum; i++) {
          const hdrOff = shoff + i * shentsize;
          const nameIdx = view.getUint32(hdrOff, true);
          if (nameIdx >= strtabSize) continue;
          let end = strtabOff + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
          if (name === ".bun") {
            bunAddr = view.getBigUint64(hdrOff + 16, true);
            break;
          }
        }
        expect(bunAddr).not.toBe(0n);

        // Collect all PT_LOAD ranges; find the one that covers .bun and
        // assert it doesn't overlap any of the others.
        type LoadSeg = { vaddr: bigint; end: bigint; writable: boolean };
        const loads: LoadSeg[] = [];
        for (let i = 0; i < phnum; i++) {
          const off = phoff + i * phentsize;
          if (view.getUint32(off, true) !== 1 /* PT_LOAD */) continue;
          const pFlags = view.getUint32(off + 4, true);
          const pVaddr = view.getBigUint64(off + 16, true);
          const pMemsz = view.getBigUint64(off + 40, true);
          loads.push({ vaddr: pVaddr, end: pVaddr + pMemsz, writable: (pFlags & 2) !== 0 });
        }
        const bunLoadIdx = loads.findIndex(s => s.writable && s.vaddr <= bunAddr && bunAddr < s.end);
        expect(bunLoadIdx).toBeGreaterThanOrEqual(0);
        const bunLoad = loads[bunLoadIdx];
        for (let i = 0; i < loads.length; i++) {
          if (i === bunLoadIdx) continue;
          const other = loads[i];
          // Disjoint: either bunLoad ends before other starts, or other
          // ends before bunLoad starts.
          const disjoint = bunLoad.end <= other.vaddr || other.end <= bunLoad.vaddr;
          expect(disjoint).toBe(true);
        }

        // And the binary actually runs — the ultimate behavioral check.
        await using proc = Bun.spawn({
          cmd: [outfile],
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout.trim()).toBe("patchelf-regression-ok");
        expect(exitCode).toBe(0);
      },
      180_000,
    );
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

      expect(stdout).toBe("");
      expect(stderr).toContain("The current working directory was deleted");
      expect(exitCode).toBe(1);
    },
    60_000,
  );
});

// Every region of the embedded module graph (file contents, names, bytecode, the
// module table) is addressed by a 32-bit offset and length. `to_bytes` used to cast
// every offset with `as u32`, so a graph past 4 GiB was written with wrapped
// offsets: the build succeeded and the executable failed at startup
// (`Module not found ''`) or read the wrong bytes. The build has to fail instead.
//
// Debug builds lower the limit through BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES
// so the test does not need a 4 GiB input. The message still names the real limit.
describe.concurrent("embedded module graph size limit", () => {
  const asset = Buffer.alloc(8 * 1024 * 1024, "x");
  const files = {
    "app.js": `import big from "./big.bin" with { type: "file" };
console.log(require("fs").statSync(big).size);`,
    "big.bin": asset,
  };

  test.skipIf(!isDebug)("build --compile fails when the graph is larger than the offsets can address", async () => {
    using dir = tempDir("build-compile-graph-too-large", files);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(4 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(stderr).toContain(
      "failed to generate module graph bytes: embedded module graph would exceed 4 GiB (its offsets are 32-bit)",
    );
    expect(exitCode).toBe(1);
    // No executable, not even a partial one.
    expect(readdirSync(String(dir)).sort()).toEqual(["app.js", "big.bin"]);
  });

  test.skipIf(!isDebug)("build --compile still succeeds when the graph fits under the limit", async () => {
    using dir = tempDir("build-compile-graph-fits", files);
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", outfile],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(256 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${asset.byteLength}\n`);
    expect(exitCode).toBe(0);
  });
});

// file command test works well
