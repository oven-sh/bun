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
import { bunExe, isASAN, isDebug, isLinux, readElf64ProgramHeaders } from "harness";

const smallestPage = 4096n;
const hugePage = 2 * 1024 * 1024;

// The anonymous mappings that the kernel makes for an ELF executable: what each writable PT_LOAD segment has in memory
// past the last page of its data in the file.
function sizesOfZeroFilledMappings(path: string) {
  const [PT_LOAD, PF_W] = [1, 2];
  const pageUp = (address: bigint) => ((address + smallestPage - 1n) / smallestPage) * smallestPage;
  return readElf64ProgramHeaders(path)
    .filter(segment => segment.type === PT_LOAD && (segment.flags & PF_W) !== 0)
    .map(segment => Number(pageUp(segment.vaddr + segment.memsz) - pageUp(segment.vaddr + segment.filesz)))
    .filter(size => size > 0);
}

// A debug build and AddressSanitizer make .bss several times larger, and nobody measures their memory.
test.skipIf(!isLinux || isDebug || isASAN)(
  "the executable's zero-filled data is smaller than a transparent huge page",
  () => {
    const sizes = sizesOfZeroFilledMappings(bunExe());
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThan(hugePage);
  },
);
