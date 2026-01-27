/**
 * Regression test for issue #18647
 *
 * Segmentation fault when using Bun macros that return objects/arrays,
 * particularly when multiple macro calls are used in object literals.
 *
 * Root cause: Use-after-free bug in src/ast/Macro.zig Runner.coerce() method.
 * The bug occurred because:
 * 1. Multiple macro calls return objects/arrays triggering recursive calls to coerce()
 * 2. The visited hash map uses getOrPut() which returns a pointer
 * 3. Recursive processing can cause hash map reallocation, invalidating the stored pointer
 * 4. Later code accesses the stale pointer, causing memory corruption
 *
 * The fix replaces unsafe getOrPut() + pointer access patterns with safe get() + put() operations.
 */

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #18647 - macro segfault with multiple calls", () => {
  test("handles multiple macro calls in object literal", async () => {
    using dir = tempDir("macro-18647-object", {
      "macro.ts": `
        export function loadContent(name: string): string {
          return \`content for \${name}\`;
        }
      `,
      "index.ts": `
        import { loadContent } from "./macro.ts" with { type: "macro" };

        const SCRIPTS = {
            addJob: loadContent("addJob"),
            moveToActive: loadContent("moveToActive"),
            moveToCompleted: loadContent("moveToCompleted"),
            moveToFailed: loadContent("moveToFailed"),
            retryJob: loadContent("retryJob"),
            moveDelayedToWait: loadContent("moveDelayedToWait"),
            extendLock: loadContent("extendLock"),
        } as const;

        if (SCRIPTS.addJob !== "content for addJob") throw new Error("Wrong addJob content");
        if (SCRIPTS.moveToActive !== "content for moveToActive") throw new Error("Wrong moveToActive content");
        if (SCRIPTS.extendLock !== "content for extendLock") throw new Error("Wrong extendLock content");
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

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("handles macro returning nested objects in array", async () => {
    using dir = tempDir("macro-18647-nested", {
      "macro.ts": `
        export function getConfig(name: string) {
          return {
            name,
            settings: {
              enabled: true,
              values: [1, 2, 3],
            },
          };
        }
      `,
      "index.ts": `
        import { getConfig } from "./macro.ts" with { type: "macro" };

        const configs = [
          getConfig("config1"),
          getConfig("config2"),
          getConfig("config3"),
          getConfig("config4"),
          getConfig("config5"),
        ];

        if (configs.length !== 5) throw new Error("Expected 5 configs");
        if (configs[0].name !== "config1") throw new Error("Wrong name");
        if (!configs[0].settings.enabled) throw new Error("Expected enabled");
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

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("handles async macro with multiple calls", async () => {
    using dir = tempDir("macro-18647-async", {
      "macro.ts": `
        export async function loadAsync(name: string) {
          // Simulate async operation
          await Promise.resolve();
          return { name, data: [1, 2, 3] };
        }
      `,
      "index.ts": `
        import { loadAsync } from "./macro.ts" with { type: "macro" };

        const items = {
          first: loadAsync("first"),
          second: loadAsync("second"),
          third: loadAsync("third"),
        };

        if (items.first.name !== "first") throw new Error("Wrong first name");
        if (items.second.name !== "second") throw new Error("Wrong second name");
        if (items.third.name !== "third") throw new Error("Wrong third name");
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

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("handles many macro calls to trigger hash map reallocation", async () => {
    using dir = tempDir("macro-18647-many", {
      "macro.ts": `
        export function getData(id: number) {
          return {
            id,
            nested: { value: id * 2 },
            array: [id, id + 1, id + 2],
          };
        }
      `,
      "index.ts": `
        import { getData } from "./macro.ts" with { type: "macro" };

        // Many calls to ensure hash map needs to resize
        const data = {
          d0: getData(0), d1: getData(1), d2: getData(2), d3: getData(3),
          d4: getData(4), d5: getData(5), d6: getData(6), d7: getData(7),
          d8: getData(8), d9: getData(9), d10: getData(10), d11: getData(11),
          d12: getData(12), d13: getData(13), d14: getData(14), d15: getData(15),
        };

        if (data.d0.id !== 0) throw new Error("Wrong d0 id");
        if (data.d15.id !== 15) throw new Error("Wrong d15 id");
        if (data.d8.nested.value !== 16) throw new Error("Wrong d8 nested value");
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

    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });
});
