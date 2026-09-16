import { $ } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

// The arena a script is parsed into is a whole mimalloc heap, so this counts
// the scripts that had to create one.
const mimallocHeapsCreated = (): number => heapStats().mimalloc.heaps.total;

test("a finished script gives its parse arena to the next script", async () => {
  await $`echo warmup`.quiet();
  const before = mimallocHeapsCreated();
  for (let i = 0; i < 100; i++) {
    expect(await $`echo ${i} && true`.text()).toBe(`${i}\n`);
  }
  // Two heaps per script when every script creates and destroys its own.
  expect(mimallocHeapsCreated() - before).toBeLessThan(10);
});

// The cap is on what the arena's pages hold. The second script's AST is under it,
// but the buffers its lexer grew and freed are not.
test.each([
  ["with an AST over the cap", `echo ${Buffer.alloc(1024 * 1024, "bun!").toString()}`],
  ["that leaves large free blocks", `echo '${Buffer.alloc(100 * 1024, "x").toString()}'`],
])("the arena of a script %s is not kept", async (_, script) => {
  await $`${{ raw: script }}`.quiet();
  const before = mimallocHeapsCreated();
  for (let i = 0; i < 10; i++) {
    await $`${{ raw: script }}`.quiet();
  }
  const created = mimallocHeapsCreated() - before;
  // Its arena is destroyed at finish, and the next script starts a new one.
  expect(created).toBeGreaterThanOrEqual(10);
  expect(created).toBeLessThan(20);
});
