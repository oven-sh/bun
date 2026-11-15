import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const program = (table: string, add: string) => `
  import { edenGC, fullGC } from "bun:jsc";
  const table = new ${table}(), keys = [];
  for (let i = 0; i < 150000; i++) { const key = {}; keys.push(key); table.${add}; }
  let dropped = [];
  for (let i = 0; i < 400000; i++) dropped.push({ i });
  edenGC();
  dropped = null;
  const began = performance.now();
  const afterFull = fullGC();
  const fullCollectionTook = performance.now() - began;
  for (const key of keys) table.delete(key);
  const afterEden = edenGC();
  console.log(JSON.stringify({ afterFull, afterEden }));
  console.error("emptied");
  // The timer for full collections never comes sooner than twenty times the length of the last one.
  await new Promise(resolve => setTimeout(resolve, fullCollectionTook * 30 + 100));
  console.error("waited");
`;

test.concurrent.each([
  ["WeakMap", "set(key, 0)"],
  ["WeakSet", "add(key)"],
])(
  "an eden collection that shrinks an old %s brings no full collection",
  async (table, add) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program(table, add)],
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1", BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_JSC_logGC: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode, stderr).toBe(0);
    const whileWaiting = stderr.slice(stderr.indexOf("emptied"), stderr.indexOf("waited"));
    const { afterFull, afterEden } = JSON.parse(stdout);
    expect({
      fullCollectionsWhileWaiting: whileWaiting.match(/=> FullCollection/g)?.length ?? 0,
      heapShrankInEdenCollection: afterEden < afterFull,
    }).toEqual({ fullCollectionsWhileWaiting: 0, heapShrankInEdenCollection: false });
  },
  120_000,
);
