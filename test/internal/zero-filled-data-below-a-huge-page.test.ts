// Where /sys/kernel/mm/transparent_hugepage/enabled is `always`, the kernel backs a stretch of anonymous memory that has
// the size and alignment of a huge page (2 MB) with one huge page, at the first write to it. Bun opts its heaps out
// (MADV_NOHUGEPAGE). It can't do that in time for the executable's zero-filled data (.bss): the kernel maps it, and the
// dynamic loader writes to it (it copies environ, stdin, stdout and stderr there) before any code of Bun runs.
//
// A mapping smaller than a huge page holds no such stretch, wherever the link puts it. At 2 MB or more it depends on the
// address the link gave .bss whether every process takes 2 MB more, so any change to Bun can switch that on, and
// test/aot/perf/start.test.ts fails for that build alone.
//
// When this fails, allocate a large table at its first use instead of declaring it zero-filled.
import { expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux } from "harness";
import { closeSync, openSync, readSync, realpathSync } from "node:fs";

const smallestPage = 4096;
const hugePage = 2 * 1024 * 1024;

// The anonymous mappings that the kernel makes for an ELF executable: what each writable PT_LOAD segment has in memory
// past the last page of its data in the file.
function sizesOfZeroFilledMappings(path: string) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(64);
    readSync(fd, header, 0, header.length, 0);
    const [PT_LOAD, PF_W] = [1, 2];
    const [entrySize, count] = [header.readUInt16LE(54), header.readUInt16LE(56)];
    const table = Buffer.alloc(entrySize * count);
    readSync(fd, table, 0, table.length, Number(header.readBigUInt64LE(32)));
    const pageUp = (address: number) => Math.ceil(address / smallestPage) * smallestPage;
    return Array.from({ length: count }, (_, index) => table.subarray(index * entrySize))
      .filter(segment => segment.readUInt32LE(0) === PT_LOAD && (segment.readUInt32LE(4) & PF_W) !== 0)
      .map(segment => {
        const address = Number(segment.readBigUInt64LE(16));
        const [fileSize, memorySize] = [Number(segment.readBigUInt64LE(32)), Number(segment.readBigUInt64LE(40))];
        return pageUp(address + memorySize) - pageUp(address + fileSize);
      })
      .filter(size => size > 0);
  } finally {
    closeSync(fd);
  }
}

// A debug build and AddressSanitizer make .bss several times larger, and nobody measures their memory.
test.skipIf(!isLinux || isDebug || isASAN)(
  "the executable's zero-filled data is smaller than a transparent huge page",
  () => {
    const sizes = sizesOfZeroFilledMappings(realpathSync(bunExe()));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(hugePage);
  },
);
