import { describe, test } from "bun:test";
import { expectRssDeltaBelow } from "harness";
import { join } from "node:path";

// Every Bun.Transpiler owns a mimalloc heap. Options that go through the JSON
// parser (`define`) or build an AST node (`exports.replace`) allocate into it.
// When a hundred or more instances are finalized by one GC, the heaps are
// destroyed in a burst and their meta data used to be stranded on full,
// abandoned mimalloc pages: about 150 KiB per instance, never reused and never
// returned to the OS. Unfixed, three batches of 100 grow RSS by about 47 MiB.
describe.concurrent("Bun.Transpiler instances finalized in one GC release their heaps", () => {
  const fixture = join(import.meta.dir, "transpiler-batch-finalize-leak-fixture.ts");

  test("define values parsed as JSON", async () => {
    await expectRssDeltaBelow([fixture, "define"], { release: 20, debug: 25 });
  });

  test("exports.replace values", async () => {
    await expectRssDeltaBelow([fixture, "exports"], { release: 20, debug: 25 });
  });
});
