// PR #29320: hintSourcePagesDontNeed() must be reached even when the
// entrypoint has top-level await. loadEntryPoint() returns a promise without
// blocking, so the call site at bun.js.zig:466 is hit synchronously before the
// main event loop spins — TLA resolution happens later in that loop.
// BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE, read by the compiled binary at
// runtime, skips the hint.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isWindows, libcPathForDlopen, tempDir } from "harness";
import path from "node:path";

// Relies on the StandaloneModuleGraph scoped logger which is compiled out in
// release builds.
test.concurrent.skipIf(isWindows || !isDebug)(
  "standalone madvise hint fires with top-level await entrypoint",
  async () => {
    using dir = tempDir("standalone-madvise-tla", {
      "entry.ts": `
      console.log("before-await");
      await new Promise<void>(r => setTimeout(r, 0));
      console.log("after-await");
    `,
    });

    const out = path.join(String(dir), "compiled");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.ts"), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);

    // BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE is read by the compiled
    // executable at runtime (the binary above was built without it); a falsy
    // value leaves the hint enabled. With the flag set, the function returns
    // before logging anything, so the only evidence is the missing line.
    for (const [flag, hinted] of [
      [undefined, true],
      ["0", true],
      ["1", false],
    ] as const) {
      await using proc = Bun.spawn({
        cmd: [out],
        env: {
          ...bunEnv,
          BUN_DEBUG_StandaloneModuleGraph: "1",
          BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE: flag,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("before-await");
      expect(stdout).toContain("after-await");
      // Scoped loggers write to the debug-writer stream (stdout by default).
      // Either the success or failure variant proves the call site is reached.
      if (hinted) {
        expect(stdout).toContain("hintSourcePagesDontNeed:");
      } else {
        expect(stdout).not.toContain("hintSourcePagesDontNeed:");
      }
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }

    // The scope is declared hidden, so without opting in the log must not
    // appear even when BUN_DEBUG_QUIET_LOGS is unset.
    {
      await using proc = Bun.spawn({
        cmd: [out],
        env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).not.toContain("hintSourcePagesDontNeed:");
      expect(stdout).toContain("before-await");
      expect(stdout).toContain("after-await");
      expect(stderr).not.toContain("hintSourcePagesDontNeed:");
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// The hint must cover only the source text, not the bytecode JSC keeps
// decoding from. The string literal below lands in both the source and the
// bytecode cache, so a hint spanning both reports at least double its size.
test.concurrent.skipIf(isWindows || !isDebug)(
  "standalone madvise hint covers only the embedded source text",
  async () => {
    const literalBytes = 64 * 1024;
    using dir = tempDir("standalone-madvise-range", {
      "entry.ts": `const s = "${Buffer.alloc(literalBytes, "a").toString()}";\nconsole.log("len=" + s.length);\n`,
    });

    const out = path.join(String(dir), "compiled");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", "--bytecode", path.join(String(dir), "entry.ts"), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [out],
      env: { ...bunEnv, BUN_DEBUG_StandaloneModuleGraph: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`len=${literalBytes}`);
    const hinted = stdout.match(/hintSourcePagesDontNeed: MADV_DONTNEED (\d+) bytes/);
    expect(hinted).not.toBeNull();
    const bytes = Number(hinted![1]);
    // Whole pages inside the source run: at most the literal plus the small
    // bundler wrapper around it, never the bytecode as well.
    expect(bytes).toBeLessThan(literalBytes + 16 * 1024);
    expect(bytes).toBeGreaterThan(literalBytes / 2);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// Issue #42509: an executable packer (UPX) unpacks the payload into anonymous
// memory. MADV_DONTNEED on anonymous pages zero-fills them on the next read,
// so a function JSC parses lazily after startup threw
// `SyntaxError: Invalid character: '\0'`. The fixture reproduces the packer's
// layout without UPX: before the hint runs it swaps the `.bun` payload pages
// for an anonymous copy (mmap + memcpy + mremap(MREMAP_FIXED)), then calls a
// function whose body spans several pages from a timer.
test.concurrent.skipIf(!isLinux)("standalone madvise hint keeps source text that is not file-backed", async () => {
  const body: string[] = ["export function lazy(n: number): number {", "  let acc = n;"];
  for (let i = 0; i < 1500; i++) body.push(`  acc = (acc * 31 + ${i}) % 1000003;`);
  body.push("  return acc;", "}");

  using dir = tempDir("standalone-madvise-anon", {
    "lazy.ts": body.join("\n") + "\n",
    "entry.ts": `
      import { lazy } from "./lazy";
      import { makePayloadAnonymous } from "./remap";
      makePayloadAnonymous();
      setTimeout(() => {
        const source = lazy.toString();
        console.log("nul=" + (source.match(/\\0/g) ?? []).length + " result=" + lazy(1));
      }, 0);
    `,
    "remap.ts": `
      import { dlopen, FFIType } from "bun:ffi";
      import { closeSync, openSync, readFileSync, readSync } from "node:fs";

      const PAGE = 4096;

      function readAt(fd: number, offset: number, length: number): Buffer {
        const buf = Buffer.alloc(length);
        let done = 0;
        while (done < length) {
          const n = readSync(fd, buf, done, length - done, offset + done);
          if (n <= 0) throw new Error("short read");
          done += n;
        }
        return buf;
      }

      // [start, end) of the pages holding the \`.bun\` section, read from the
      // executable's own ELF headers.
      function payloadRange(): [number, number] {
        const exe = process.execPath;
        const fd = openSync(exe, "r");
        try {
          const ehdr = readAt(fd, 0, 64);
          const eType = ehdr.readUInt16LE(0x10);
          const phoff = Number(ehdr.readBigUInt64LE(0x20));
          const shoff = Number(ehdr.readBigUInt64LE(0x28));
          const phentsize = ehdr.readUInt16LE(0x36);
          const phnum = ehdr.readUInt16LE(0x38);
          const shentsize = ehdr.readUInt16LE(0x3a);
          const shnum = ehdr.readUInt16LE(0x3c);
          const shstrndx = ehdr.readUInt16LE(0x3e);

          const shdrs = readAt(fd, shoff, shentsize * shnum);
          const shdr = (i: number) => shdrs.subarray(i * shentsize, (i + 1) * shentsize);
          const strtab = shdr(shstrndx);
          const names = readAt(fd, Number(strtab.readBigUInt64LE(24)), Number(strtab.readBigUInt64LE(32)));

          let addr = -1;
          let size = 0;
          for (let i = 0; i < shnum; i++) {
            const s = shdr(i);
            const nameOff = s.readUInt32LE(0);
            if (names.toString("latin1", nameOff, names.indexOf(0, nameOff)) === ".bun") {
              addr = Number(s.readBigUInt64LE(16));
              size = Number(s.readBigUInt64LE(32));
            }
          }
          if (addr < 0) throw new Error("no .bun section");

          let bias = 0;
          if (eType === 3) {
            // ET_DYN: load bias = where the first PT_LOAD landed minus its link address.
            const phdrs = readAt(fd, phoff, phentsize * phnum);
            let firstVaddr = -1;
            for (let i = 0; i < phnum; i++) {
              const p = phdrs.subarray(i * phentsize, (i + 1) * phentsize);
              if (p.readUInt32LE(0) === 1 && p.readBigUInt64LE(8) === 0n) {
                firstVaddr = Number(p.readBigUInt64LE(16));
                break;
              }
            }
            const line = readFileSync("/proc/self/maps", "utf8")
              .split("\\n")
              .find(l => l.endsWith(" " + exe) && l.split(/\\s+/)[2] === "00000000");
            if (!line || firstVaddr < 0) throw new Error("cannot compute load bias");
            bias = parseInt(line.split("-")[0], 16) - firstVaddr;
          }

          return [Math.floor((addr + bias) / PAGE) * PAGE, Math.ceil((addr + bias + size) / PAGE) * PAGE];
        } finally {
          closeSync(fd);
        }
      }

      export function makePayloadAnonymous(): void {
        const [start, end] = payloadRange();
        const len = end - start;
        const { symbols } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
          mmap: {
            args: [FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i64],
            returns: FFIType.ptr,
          },
          memcpy: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
          mremap: { args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
        });
        const PROT_READ = 1, PROT_WRITE = 2;
        const MAP_PRIVATE = 2, MAP_ANONYMOUS = 0x20;
        const MREMAP_MAYMOVE = 1, MREMAP_FIXED = 2;

        const copy = symbols.mmap(0, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (!copy || Number(copy) === -1) throw new Error("mmap failed");
        symbols.memcpy(copy, start, len);
        // MREMAP_FIXED replaces the file-backed payload mapping in one step.
        if (Number(symbols.mremap(copy, len, len, MREMAP_MAYMOVE | MREMAP_FIXED, start)) !== start) {
          throw new Error("mremap failed");
        }
      }
    `,
  });

  const out = path.join(String(dir), "compiled");
  const build = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.ts"), "--outfile", out],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(build.stderr.toString()).not.toContain("error:");
  expect(build.exitCode).toBe(0);

  await using proc = Bun.spawn({
    cmd: [out],
    env: { ...bunEnv, BUN_DEBUG_StandaloneModuleGraph: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("nul=0 result=195229");
  if (isDebug) {
    expect(stdout).toContain("hintSourcePagesDontNeed: source text is not file-backed, keeping it");
  }
  expect(exitCode).toBe(0);
});
