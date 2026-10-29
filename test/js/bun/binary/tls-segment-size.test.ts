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
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isFreeBSD,
  isLinux,
  isWindows,
  preadExact,
  readElf64ProgramHeaders,
} from "harness";
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

// Where /sys/kernel/mm/transparent_hugepage/enabled is `always`, the kernel backs a stretch of anonymous memory that has
// the size and alignment of a huge page (2 MB) with one huge page, at the first write to it. Bun opts its heaps out
// (MADV_NOHUGEPAGE). It can't do that in time for the executable's zero-filled data (.bss): the kernel maps it, and the
// dynamic loader writes to it (it copies environ, stdin, stdout and stderr there) before any code of Bun runs.
//
// A mapping smaller than a huge page holds no such stretch, wherever the link puts it. At 2 MB or more it depends on the
// address the link gave .bss whether every process takes 2 MB more, so any change to Bun can switch that on, and
// test/aot/perf/start.test.ts fails for that build alone.
//
// When one of these fails, allocate the large table at its first use instead of declaring it zero-filled.
describe("zero-filled data", () => {
  const smallestPage = 4096n;
  const hugePage = 2 * 1024 * 1024;
  const [PT_LOAD, PF_W] = [1, 2];
  const pageUp = (address: bigint) => ((address + smallestPage - 1n) / smallestPage) * smallestPage;

  // The anonymous mappings that the kernel makes for an ELF executable, at the addresses of the link: what each
  // writable PT_LOAD segment has in memory past the last page of its data in the file.
  function zeroFilledMappings(path: string) {
    return readElf64ProgramHeaders(path)
      .filter(segment => segment.type === PT_LOAD && (segment.flags & PF_W) !== 0)
      .map(segment => ({ start: pageUp(segment.vaddr + segment.filesz), end: pageUp(segment.vaddr + segment.memsz) }))
      .filter(mapping => mapping.end > mapping.start);
  }

  // A debug build and AddressSanitizer make .bss several times larger, and nobody measures their memory. The link of a
  // build that ships holds the same limit (zeroFilledBelow in scripts/build/binary-expectations.ts).
  test.skipIf(!isLinux || isDebug || isASAN)("is smaller than a transparent huge page", () => {
    const sizes = zeroFilledMappings(bunExe()).map(mapping => Number(mapping.end - mapping.start));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(hugePage);
  });

  // The Huffman tables of HPACK (768 KB, which only a process that speaks HTTP/2 or HTTP/3 fills) were zero-filled
  // data. A new process reads its own zero-filled data before and after its first HTTP/2 request: the longest stretch
  // of pages that the request filled is the largest table that lives there.
  test.skipIf(!isLinux)(
    "the first HTTP/2 request fills no large table in it",
    async () => {
      const mappings = zeroFilledMappings(bunExe()).map(mapping => [Number(mapping.start), Number(mapping.end)]);
      const lowest = readElf64ProgramHeaders(bunExe())
        .filter(segment => segment.type === PT_LOAD)
        .map(segment => Number(segment.vaddr))
        .reduce((least, address) => Math.min(least, address));
      const script = `
        const { openSync, readFileSync, readlinkSync, readSync } = require("node:fs");
        const [mappings, lowest] = [JSON.parse(process.argv[1]), Number(process.argv[2])];
        // Where the kernel put the executable, which is not where the link put a position-independent one.
        const executable = readlinkSync("/proc/self/exe");
        const first = readFileSync("/proc/self/maps", "utf8")
          .split("\\n")
          .find(line => line.endsWith(" " + executable));
        const moved = parseInt(first.split("-")[0], 16) - (lowest - (lowest % 4096));
        const memory = openSync("/proc/self/mem", "r");
        const read = () =>
          mappings.map(([start, end]) => {
            const bytes = Buffer.alloc(end - start);
            for (let at = 0; at < bytes.length; ) {
              const count = readSync(memory, bytes, at, bytes.length - at, start + moved + at);
              if (count === 0) throw new Error("/proc/self/mem ended early");
              at += count;
            }
            return bytes;
          });
        const before = read();

        const http2 = require("node:http2");
        const server = http2.createServer((request, response) => response.end("the response"));
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const client = http2.connect("http://127.0.0.1:" + server.address().port);
        const body = await new Promise((resolve, reject) => {
          client.on("error", reject);
          const request = client.request({ ":path": "/", "x-a-header": "a value that the client codes with the tables" });
          let text = "";
          request.setEncoding("utf8");
          request.on("data", chunk => (text += chunk));
          request.on("end", () => resolve(text));
          request.on("error", reject);
          request.end();
        });

        const after = read();
        const empty = Buffer.alloc(4096);
        let longest = 0;
        for (const [mapping, was] of before.entries()) {
          for (let at = 0, filled = 0; at < was.length; at += 4096) {
            const wasEmpty = was.subarray(at, at + 4096).equals(empty);
            const isEmpty = after[mapping].subarray(at, at + 4096).equals(empty);
            filled = wasEmpty && !isEmpty ? filled + 4096 : 0;
            longest = Math.max(longest, filled);
          }
        }
        console.log(JSON.stringify({ body, longestStretchFilled: longest }));
        process.exit(0);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, JSON.stringify(mappings), String(lowest)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const result = stdout.startsWith("{") ? JSON.parse(stdout) : { stdout, stderr };
      expect(result).toEqual({ body: "the response", longestStretchFilled: expect.any(Number) });
      // The tables are 512 KB and 256 KB. What else the request fills there is a few pages.
      expect(result.longestStretchFilled).toBeLessThan(128 * 1024);
      expect(exitCode).toBe(0);
    },
    // In a debug build the new process takes 3 to 7 seconds.
    isDebug ? 60_000 : undefined,
  );
});
