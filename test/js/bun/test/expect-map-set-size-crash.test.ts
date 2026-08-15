import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("failing matcher on a Map or Set whose size is not a number still reports the mismatch", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { expect } = require("bun:test");
const weakSet = new WeakSet();
weakSet.size = {};
const weakMap = new WeakMap();
weakMap.size = "abc";
const set = new Set([1, 2]);
Object.defineProperty(set, "size", { value: {} });
const map = new Map([[1, 2]]);
Object.defineProperty(map, "size", { value: null });
for (const value of [weakSet, weakMap, set, map]) {
  try {
    expect(value).toEqual(1);
  } catch (e) {
    console.log(e.message);
  }
}`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "expect(received).toEqual(expected)

    Expected: 1
    Received: WeakSet {}

    expect(received).toEqual(expected)

    Expected: 1
    Received: WeakMap {}

    expect(received).toEqual(expected)

    Expected: 1
    Received: Set {}

    expect(received).toEqual(expected)

    Expected: 1
    Received: Map {}"
  `);
  expect(exitCode).toBe(0);
});
