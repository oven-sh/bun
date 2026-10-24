import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDir } from "harness";
import {
  closeSync,
  copyFileSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

// Huge, but adding small offsets to it doesn't overflow.
const HUGE_LENGTH = 0x0000ffffffffffffn;

// `bun build --compile` copies the whole bun binary, about 1 GB for a debug build.
const TIMEOUT = 120_000;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const n = readSync(fd, buf, total, length - total, position + total);
    if (n === 0) throw new Error(`unexpected EOF at ${position + total}`);
    total += n;
  }
  return buf;
}

function writeU64At(fd: number, position: number, value: bigint): void {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  writeSync(fd, buf, 0, 8, position);
}

/// In bun itself, the ".bun" section is the BUN_COMPILED header. `bun build --compile` points the section header at
/// the embedded payload instead, so sh_addr and sh_offset locate `[u64 LE length][payload]`.
function elfFindBunSection(fd: number): { fileOffset: number; vaddr: bigint } {
  const ehdr = readAt(fd, 0, 64);
  if (ehdr.readUInt32BE(0) !== 0x7f454c46) throw new Error("not an ELF file");
  const e_shoff = Number(ehdr.readBigUInt64LE(0x28));
  const e_shentsize = ehdr.readUInt16LE(0x3a);
  const e_shnum = ehdr.readUInt16LE(0x3c);
  const e_shstrndx = ehdr.readUInt16LE(0x3e);

  const shstrtab = readAt(fd, e_shoff + e_shstrndx * e_shentsize, e_shentsize);
  const shstrOff = Number(shstrtab.readBigUInt64LE(0x18));

  for (let i = 0; i < e_shnum; i++) {
    const sh = readAt(fd, e_shoff + i * e_shentsize, e_shentsize);
    const name = readAt(fd, shstrOff + sh.readUInt32LE(0), 5);
    if (name.toString("latin1") === ".bun\0") {
      return {
        fileOffset: Number(sh.readBigUInt64LE(0x18)),
        vaddr: sh.readBigUInt64LE(0x10),
      };
    }
  }
  throw new Error("no .bun section");
}

/// Overwrites the payload's u64 length prefix.
function elfStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const { fileOffset } = elfFindBunSection(fd);
    writeU64At(fd, fileOffset, HUGE_LENGTH);
  } finally {
    closeSync(fd);
  }
}

/// Overwrites the payload vaddr in the BUN_COMPILED header, which stays at the file offset it has in bun itself.
function elfStompVaddr(path: string, newVaddr: bigint): void {
  const bun = openSync(bunExe(), "r");
  const fd = openSync(path, "r+");
  try {
    const position = elfFindBunSection(bun).fileOffset;
    expect(readAt(fd, position, 8).readBigUInt64LE()).toBe(elfFindBunSection(fd).vaddr);
    writeU64At(fd, position, newVaddr);
  } finally {
    closeSync(fd);
    closeSync(bun);
  }
}

/// Overwrites the length prefix. The ".bun" PE section's raw data is `[u64 LE length][payload]`.
function peStompLength(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const dos = readAt(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not a PE file");
    const lfanew = dos.readUInt32LE(0x3c);
    const head = readAt(fd, lfanew, 24);
    if (head.readUInt32LE(0) !== 0x00004550) throw new Error("bad PE signature");
    const numberOfSections = head.readUInt16LE(6);
    const sizeOfOptionalHeader = head.readUInt16LE(20);
    const sectionTable = lfanew + 24 + sizeOfOptionalHeader;

    for (let i = 0; i < numberOfSections; i++) {
      const sh = readAt(fd, sectionTable + i * 40, 40);
      if (sh.toString("latin1", 0, 8) === ".bun\0\0\0\0") {
        writeU64At(fd, sh.readUInt32LE(20) /* PointerToRawData */, HUGE_LENGTH);
        return;
      }
    }
    throw new Error("no .bun section");
  } finally {
    closeSync(fd);
  }
}

async function compileApp(dir: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "./app.js", "--outfile", "app"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return join(dir, isWindows ? "app.exe" : "app");
}

async function run(exe: string, args: string[] = [], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [exe, ...args],
    // BUN_BE_BUN would skip loading the embedded graph, so unset it.
    env: { ...bunEnv, BUN_BE_BUN: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Without its graph, the executable behaves like plain `bun`.
async function expectGracefulFallback(exe: string) {
  expect(await run(exe, ["-e", "console.log('fallback-ok')"])).toEqual({
    stdout: "fallback-ok\n",
    stderr: "",
    exitCode: 0,
  });
  rmSync(exe);
}

function corruptedCopy(exe: string, suffix: string, stomp: (path: string) => void): string {
  const corrupted = isWindows ? exe.replace(/\.exe$/, `-${suffix}.exe`) : `${exe}-${suffix}`;
  copyFileSync(exe, corrupted);
  stomp(corrupted);
  return corrupted;
}

// macOS is skipped because a patched Mach-O needs a new signature.
test.skipIf(isMacOS)(
  "doesn't crash at startup when the graph length or address points outside mapped memory",
  async () => {
    using dir = tempDir("compile-corrupted-length", {
      "app.js": `console.log("hello from standalone");`,
    });
    const exe = await compileApp(String(dir));
    expect(await run(exe)).toEqual({ stdout: "hello from standalone\n", stderr: "", exitCode: 0 });

    await expectGracefulFallback(corruptedCopy(exe, "length", isWindows ? peStompLength : elfStompLength));
    if (!isWindows) {
      await expectGracefulFallback(corruptedCopy(exe, "vaddr", path => elfStompVaddr(path, 0x4141414141414141n)));
    }
  },
  TIMEOUT,
);

// The graph ends with `Offsets`, then the trailer. `Offsets` is byte_count u64, modules_ptr { offset u32, length u32 },
// entry_point_id u32, compile_exec_argv_ptr { offset u32, length u32 }, flags u32.
// macOS is skipped because a patched Mach-O needs a new signature. Every platform uses the same reader.
test.skipIf(isMacOS)(
  "reports an out-of-range entry point ID at startup",
  async () => {
    using dir = tempDir("compile-corrupted-graph", {
      "app.js": `console.log("should not run");`,
    });
    const exe = await compileApp(String(dir));

    const bytes = readFileSync(exe);
    const offsetsAt = bytes.lastIndexOf("\n---- Bun! ----\n") - 32;
    // There's one 52-byte module, so entry point ID 1 is one past the end.
    expect(bytes.readUInt32LE(offsetsAt + 12)).toBe(52);

    const corrupted = corruptedCopy(exe, "field", path => {
      const fd = openSync(path, "r+");
      try {
        const u32 = Buffer.alloc(4);
        u32.writeUInt32LE(1);
        writeSync(fd, u32, 0, 4, offsetsAt + 16);
      } finally {
        closeSync(fd);
      }
    });
    expect(await run(corrupted)).toEqual({
      stdout: "",
      stderr: expect.stringContaining("Corrupted module graph: entry point ID is greater than module list count"),
      exitCode: 1,
    });
    rmSync(corrupted);
  },
  TIMEOUT,
);

// The kernel maps the payload's segment without checking the file's length, so a truncated executable still starts.
// The check needs MADV_POPULATE_READ (Linux 5.14).
const [kernelMajor, kernelMinor] = release().split(".").map(Number);
test.if(isLinux && (kernelMajor > 5 || (kernelMajor === 5 && kernelMinor >= 14)))(
  "exits with an error when a standalone executable is truncated",
  async () => {
    using dir = tempDir("compile-truncated", {
      "big.txt": Buffer.alloc(1024 * 1024, "x").toString(),
      "app.js": `import big from "./big.txt" with { type: "text" }; console.log("intact-" + big.length);`,
    });
    const exe = await compileApp(String(dir));
    expect(await run(exe)).toEqual({ stdout: "intact-1048576\n", stderr: "", exitCode: 0 });

    const fd = openSync(exe, "r");
    const { fileOffset } = elfFindBunSection(fd);
    closeSync(fd);

    // The first cut keeps the length header's page but drops the trailer. The second drops the whole payload.
    for (const length of [fileOffset + 64 * 1024, fileOffset]) {
      const cut = corruptedCopy(exe, "cut", path => truncateSync(path, length));
      // At exit, LeakSanitizer would scan mapped pages that are past the end of the file.
      const ASAN_OPTIONS = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");
      expect(await run(cut, [], { ASAN_OPTIONS })).toEqual({
        stdout: "",
        stderr:
          `error: "${realpathSync(cut)}" is truncated. Part of its embedded program is missing.\n` +
          "note: The download or copy was probably interrupted. Download or install it again.\n",
        exitCode: 1,
      });
      rmSync(cut);
    }
  },
  TIMEOUT,
);
