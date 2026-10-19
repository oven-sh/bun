import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An object with more than 128 named properties gets a dictionary structure in JavaScriptCore, and a
// delete, an attribute change or a prototype change moves the object to a new structure. That transition
// used to copy the dictionary's property table: O(n) time and a table of n entries allocated per delete,
// which made the delete and re-add loop of issue #44583 about 100x slower than node. The transition now
// takes the table. `heapStats().objectTypeCounts` counts the cells in the heap, the unswept ones included,
// so the count of PropertyTable cells says how many tables a loop allocated. A loop that only adds or only
// changes attributes allocates 8 to 12 tables per 100 iterations on any build (the table grows, and the
// inline caches flatten the dictionary once). Before the fix each loop below allocated one more per iteration.
const tableBound = 30;
async function propertyTablesAllocatedBy(
  loopBody: string,
  { object = 'const object = {}; for (let i = 0; i < 1000; i++) object["key" + i] = i;', env = bunEnv } = {},
): Promise<{ propertyTables: number; keys: number; value: unknown; writable: boolean; prototypeMarker: unknown }> {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { heapStats, fullGC } = require("bun:jsc");
        ${object}
        const body = (object, i) => { ${loopBody} };
        for (let i = 0; i < 8; i++) body(object, i);
        fullGC();
        const before = heapStats().objectTypeCounts.PropertyTable ?? 0;
        for (let i = 0; i < 100; i++) body(object, i);
        const after = heapStats().objectTypeCounts.PropertyTable ?? 0;
        console.log(JSON.stringify({
          propertyTables: after - before,
          keys: Object.keys(object).length,
          value: object.key0,
          writable: Object.getOwnPropertyDescriptor(object, "key0").writable,
          prototypeMarker: Object.getPrototypeOf(object)?.b,
        }));
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe.concurrent("a transition away from a dictionary structure takes its property table", () => {
  test("deleting and re-adding a property on a large object does not copy its property table", async () => {
    const result = await propertyTablesAllocatedBy("delete object.key0; object.key0 = i;");
    // Before the fix: 109 for 100 iterations.
    expect(result.propertyTables).toBeLessThan(tableBound);
    expect(result).toMatchObject({ keys: 1000, value: 99 });
  });

  test("changing the attributes of a property on a large object does not copy its property table", async () => {
    // An add pins the table in place. The attribute change after it used to copy the table.
    const result = await propertyTablesAllocatedBy(
      'object["added" + i] = i; Object.defineProperty(object, "key0", { value: i, writable: i % 2 === 0, enumerable: true, configurable: true });',
    );
    expect(result.propertyTables).toBeLessThan(tableBound);
    expect(result).toMatchObject({ keys: 1100, value: 99, writable: false });
  });

  test("changing the prototype of a large object does not copy its property table", async () => {
    // A prototype change pins the table in the new structure. It took a copy of the dictionary's table.
    const result = await propertyTablesAllocatedBy("Object.setPrototypeOf(object, prototypes[i & 1]);", {
      object:
        'const object = {}; for (let i = 0; i < 1000; i++) object["key" + i] = i; const prototypes = [{ a: 1 }, { b: 2 }];',
    });
    expect(result.propertyTables).toBeLessThan(tableBound);
    expect(result).toMatchObject({ keys: 1000, value: 0, prototypeMarker: 2 });
  });

  test("deleting and re-adding a variable in a large process.env does not copy its property table", async () => {
    // process.env is the same kind of object once the environment has more than 128 variables.
    const env = { ...bunEnv };
    for (let i = 0; i < 200; i++) env[`ROBOBUN_VAR_${i}`] = String(i);
    // Before the fix: 36 tables, with any number of iterations over 36 (after that the object is in a state the
    // engine edits in place). After: 10.
    const result = await propertyTablesAllocatedBy("delete object.key0; object.key0 = String(i);", {
      object: "const object = process.env;",
      env,
    });
    expect(result.propertyTables).toBeLessThan(20);
    expect(result).toMatchObject({ value: "99" });
    expect(result.keys).toBeGreaterThan(200);
  });
});
