import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, compileFixture } from "harness";
import { join } from "node:path";

let holdAddressesLib: string | undefined;
try {
  holdAddressesLib = compileFixture(join(import.meta.dir, "hold-addresses.c"));
} catch (e) {
  if (!String((e as Error)?.message ?? e).includes("no C compiler")) throw e;
  console.warn(`[map-set-table-conservative-root] skipped: ${(e as Error)?.message ?? e}`);
}

async function heapGrowth(operation: string, words: "block-end" | "interior") {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "map-set-table-conservative-root-fixture.mjs"),
      holdAddressesLib!,
      operation,
      words,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { growthWhileHeld, ...rest } = JSON.parse(stdout);
  expect(rest).toEqual({ held: 32768, size: 0, cycles: 40_000 });
  expect(exitCode).toBe(0);
  return growthWhileHeld as number;
}

// A Map or a Set replaces its table when it rehashes or clears. The old table points at the new
// one, so that an iterator that still holds the old one can move forward. One old table that stays
// marked therefore keeps every later table, with the keys and values each of them held when it was
// replaced. A collection whose entries come and go then grows the heap without bound.
//
// The conservative scan marked the last cell of a MarkedBlock for any word equal to the address of
// the end of that block, because a Butterfly* can point past the end of its storage. The memory
// after a block can hold any long-lived native object. The JSC::VM itself has been there, and its
// address is on the stack at every collection. The fixture puts such words on the stack on purpose.
describe.skipIf(!holdAddressesLib).concurrent("Map and Set tables and the conservative scan", () => {
  // All 10,000 tables of the delete variants are 2.2 MB. All 40,000 of the clear variant are 9 MB.
  test.each(["Map set + delete", "Set add + delete", "Map set + clear"])(
    "a word equal to the end of a MarkedBlock does not keep a replaced table alive: %s",
    async operation => {
      expect(await heapGrowth(operation, "block-end")).toBeLessThan(512 * 1024);
    },
  );

  test("control: a word that points into a replaced table keeps it and every later table alive", async () => {
    expect(await heapGrowth("Map set + delete", "interior")).toBeGreaterThan(1024 * 1024);
  });
});
