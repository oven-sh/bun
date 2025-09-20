import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for macro panic with collections containing three or more arrays/objects
// This was caused by hash table resizing invalidating pointers during recursive processing
test("macros should handle collections with 3+ arrays/objects", async () => {
  using dir = tempDir("macro-array-objects", {
    "macro.ts": `
      export function collectionOfArrays() {
        return [{ a: [] }, { b: [] }, { c: [] }];
      }

      export function collectionOfObjects() {
        return [{ a: {} }, { b: {} }, { c: {} }];
      }

      export function nestedArrays() {
        return [[[1]], [[2]], [[3]]];
      }

      export function mixedCollection() {
        return [
          { arr: [], obj: {} },
          { arr: [], obj: {} },
          { arr: [], obj: {} },
        ];
      }

      export function deeplyNestedObjects() {
        // This creates many nested objects that will cause hash table resizing
        return {
          level1: { a: {}, b: {}, c: {} },
          level2: { d: {}, e: {}, f: {} },
          level3: { g: {}, h: {}, i: {} },
          level4: { j: {}, k: {}, l: {} },
          level5: { m: {}, n: {}, o: {} },
          arrays: [
            { p: [], q: [], r: [] },
            { s: [], t: [], u: [] },
            { v: [], w: [], x: [] }
          ]
        };
      }

      export function manyProperties() {
        // Object with many properties to trigger hash table operations
        const obj = {};
        for (let i = 0; i < 50; i++) {
          obj['prop' + i] = { value: [], nested: {} };
        }
        return obj;
      }
    `,
    "index.ts": `
      import {
        collectionOfArrays,
        collectionOfObjects,
        nestedArrays,
        mixedCollection,
        deeplyNestedObjects,
        manyProperties
      } from "./macro" with { type: "macro" };

      const arrays = collectionOfArrays();
      const objects = collectionOfObjects();
      const nested = nestedArrays();
      const mixed = mixedCollection();
      const deep = deeplyNestedObjects();
      const many = manyProperties();

      console.log("arrays:", JSON.stringify(arrays));
      console.log("objects:", JSON.stringify(objects));
      console.log("nested:", JSON.stringify(nested));
      console.log("mixed:", JSON.stringify(mixed));

      // Verify the structure
      if (arrays.length !== 3) throw new Error("arrays length mismatch");
      if (objects.length !== 3) throw new Error("objects length mismatch");
      if (nested.length !== 3) throw new Error("nested length mismatch");
      if (mixed.length !== 3) throw new Error("mixed length mismatch");

      // Verify deep nesting worked
      if (!deep.level1 || !deep.level5 || !deep.arrays) throw new Error("deep nesting failed");
      if (deep.arrays.length !== 3) throw new Error("deep arrays length mismatch");

      // Verify many properties worked
      if (Object.keys(many).length !== 50) throw new Error("many properties count mismatch");

      console.log("SUCCESS");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Check output contains expected values
  expect(stdout).toContain('arrays: [{"a":[]},{"b":[]},{"c":[]}]');
  expect(stdout).toContain('objects: [{"a":{}},{"b":{}},{"c":{}}]');
  expect(stdout).toContain("nested: [[[1]],[[2]],[[3]]]");
  expect(stdout).toContain('mixed: [{"arr":[],"obj":{}},{"arr":[],"obj":{}},{"arr":[],"obj":{}}]');
  expect(stdout).toContain("SUCCESS");
});
