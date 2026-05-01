/**
 * Regression test for issue #22656, #11730, and #7116
 *
 * These issues all related to the same root cause:
 * - Hash table resizing during recursive macro processing invalidated pointers
 * - This caused panics with "switch on corrupt value" or segmentation faults
 * - The crash occurred when macros returned collections with 3+ arrays/objects
 *
 * The fix:
 * 1. Seeds a placeholder immediately after getOrPut to prevent uninitialized memory access
 * 2. Uses `put` after processing to handle hash table resizing during recursion
 * 3. Removes overly strict circular reference checks that incorrectly triggered on shared refs
 */

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #22656 - macro array/object handling", () => {
  test("handles collections with 3+ arrays without crashing", async () => {
    using dir = tempDir("macro-arrays", {
      "macro.ts": `
        export function test() {
          // This pattern caused crashes before the fix
          return [
            { a: [] },
            { b: [] },
            { c: [] },
            { d: [] },  // More than 3 to ensure it's fixed
            { e: [] }
          ];
        }
      `,
      "index.ts": `
        import { test } from './macro.ts' with { type: "macro" };
        const result = test();
        if (result.length !== 5) throw new Error("Expected 5 items");
        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("corrupt value");
  });

  test("handles collections with 3+ objects without crashing", async () => {
    using dir = tempDir("macro-objects", {
      "macro.ts": `
        export function test() {
          // This pattern also caused crashes
          return [
            { a: {} },
            { b: {} },
            { c: {} },
            { d: {} },
            { e: {} }
          ];
        }
      `,
      "index.ts": `
        import { test } from './macro.ts' with { type: "macro" };
        const result = test();
        if (result.length !== 5) throw new Error("Expected 5 items");
        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });

  test("handles deeply nested objects (issue #11730)", async () => {
    using dir = tempDir("macro-deep", {
      "macro.ts": `
        export function test() {
          const complex = {
            type: 'root',
            children: Array.from({ length: 10 }, (_, i) => ({
              id: i,
              nested: {
                arrays: [[], [], []],
                objects: [{}, {}, {}],
                deep: { value: i }
              }
            })),
            meta: Array.from({ length: 20 }, (_, i) => ({
              key: 'key_' + i,
              value: { nested: { deeply: { value: i } } }
            }))
          };
          // JSON parse/stringify pattern that was common in the bug reports
          const makeObject = () => JSON.parse(JSON.stringify(complex));
          return [makeObject(), makeObject(), makeObject(), makeObject(), makeObject()];
        }
      `,
      "index.ts": `
        import { test } from './macro.ts' with { type: "macro" };
        const result = test();
        if (result.length !== 5) throw new Error("Expected 5 items");
        if (result[0].type !== 'root') throw new Error("Expected root type");
        if (result[0].children.length !== 10) throw new Error("Expected 10 children");
        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });

  test("handles large arrays with spreading (issue #7116)", async () => {
    using dir = tempDir("macro-spread", {
      "macro.ts": `
        export function test() {
          const baseArray = Array.from({ length: 10 }, (_, i) => ({
            name: 'item_' + i,
            data: {
              arrays: [[], [], []],
              objects: [{}, {}, {}]
            },
            extra: {
              values: Array.from({ length: 5 }, (_, j) => ({ x: j }))
            }
          }));

          const transform = () => baseArray.map(x => ({
            ...x,
            additional: {
              arrays: [{ a: [] }, { b: [] }, { c: [] }, { d: [] }],
              objects: [{ w: {} }, { x: {} }, { y: {} }, { z: {} }]
            }
          }));

          // Spreading pattern that triggered the bug
          return [...transform(), ...transform(), ...transform()];
        }
      `,
      "index.ts": `
        import { test } from './macro.ts' with { type: "macro" };
        const result = test();
        if (result.length !== 30) throw new Error("Expected 30 items");
        if (!result[0].additional) throw new Error("Expected additional property");
        if (!result[0].additional.arrays) throw new Error("Expected arrays");
        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });

  test("correctly handles shared references vs circular references", async () => {
    using dir = tempDir("macro-circular", {
      "macro.ts": `
        export function sharedRefs() {
          // Shared references should work fine
          const obj = { data: [] };
          return [obj, obj, obj, obj, obj];  // 5 references to same object
        }

        export function nestedShared() {
          // Nested shared references
          const inner = { x: {} };
          const outer = { a: inner, b: inner, c: inner };
          return [outer, outer, outer];
        }
      `,
      "index.ts": `
        import { sharedRefs, nestedShared } from './macro.ts' with { type: "macro" };

        const shared = sharedRefs();
        if (shared.length !== 5) throw new Error("Expected 5 shared refs");

        const nested = nestedShared();
        if (nested.length !== 3) throw new Error("Expected 3 nested");

        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });
});
