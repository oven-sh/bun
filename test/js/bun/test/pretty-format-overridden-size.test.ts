// Regression test for the jest pretty formatter reading an overridden `size`
// property off (Weak)Set/(Weak)Map values while printing a toEqual diff.
// Previously a non-numeric `size` hit the isInt32() assertion in
// JSC::JSValue::asInt32() on debug builds.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("pretty_format should handle collections with an overridden `size` property", () => {
  test("non-numeric `size` on (Weak)Set/(Weak)Map still produces a toEqual diff", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const values = [];
{
  const weakSet = new WeakSet();
  weakSet.size = BigUint64Array;
  values.push(weakSet);
}
{
  const weakMap = new WeakMap();
  weakMap.size = "not a number";
  values.push(weakMap);
}
{
  const set = new Set([1]);
  Object.defineProperty(set, "size", { value: {} });
  values.push(set);
}
{
  const map = new Map([[1, 2]]);
  Object.defineProperty(map, "size", { value: BigUint64Array });
  values.push(map);
}
{
  const weakSet = new WeakSet();
  weakSet.size = Symbol("size");
  values.push(weakSet);
}
for (const value of values) {
  try {
    Bun.jest().expect(BigUint64Array).toEqual(value);
    console.log("DID NOT THROW");
  } catch (e) {
    console.log(e.message.includes("expect(received).toEqual(expected)") ? "DIFF OK" : "UNEXPECTED: " + e.message);
  }
}
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual(["DIFF OK", "DIFF OK", "DIFF OK", "DIFF OK", "DIFF OK"]);
    expect(exitCode).toBe(0);
  });
});

// A Map or Set whose iteration user code can observe (a subclass, or a replaced
// `prototype[Symbol.iterator]`) is printed through that iterator. The printer takes as many
// entries as `size` reports. It closes an iterator that has more, like `break` in a for-of.
describe("pretty_format bounds a (Map|Set) iterator that user code can observe by `size`", () => {
  // These iterators are finite and count their steps. A printer that walks the whole
  // iterator then fails the snapshot. It does not hang the runner.
  function counted(entry: (step: number) => unknown) {
    const seen = { steps: 0, closed: 0 };
    const iterator = (): any => ({
      next: () => ({ done: ++seen.steps > 10, value: entry(seen.steps) }),
      return: () => (seen.closed++, {}),
    });
    return { seen, iterator };
  }

  test("a Map subclass whose iterator has more entries than `size`", () => {
    const { seen, iterator } = counted(step => [`key${step}`, step]);
    class LongMap extends Map<string, number> {
      [Symbol.iterator]() {
        return iterator();
      }
    }
    expect(
      new LongMap([
        ["a", 1],
        ["b", 2],
      ]),
    ).toMatchInlineSnapshot(`
      Map {
        "key1" => 1,
        "key2" => 2,
      }
    `);
    // Two entries, one more step that finds a third entry, then return().
    expect(seen).toEqual({ steps: 3, closed: 1 });
  });

  test("a Set subclass whose iterator has more entries than `size`", () => {
    const { seen, iterator } = counted(step => `value${step}`);
    class LongSet extends Set {
      [Symbol.iterator]() {
        return iterator();
      }
    }
    expect(new LongSet(["a", "b"])).toMatchInlineSnapshot(`
      Set {
        "value1",
        "value2",
      }
    `);
    expect(seen).toEqual({ steps: 3, closed: 1 });
  });

  test("a subclass that keeps its entries outside the inherited storage prints every entry", () => {
    let finished = 0;
    class Cache extends Map {
      #entries = [
        ["x", 1],
        ["y", 2],
        ["z", 3],
      ];
      get size() {
        return this.#entries.length;
      }
      *[Symbol.iterator](): any {
        yield* this.#entries;
        finished++;
      }
    }
    expect(new Cache()).toMatchInlineSnapshot(`
      Map {
        "x" => 1,
        "y" => 2,
        "z" => 3,
      }
    `);
    // The iterator ends after `size` entries, so it runs to completion. Nothing closes it early.
    expect(finished).toBe(1);
  });

  test("a Map with the built-in iteration is read from its storage, whatever `size` says", () => {
    const map = new Map([
      ["x", 1],
      ["y", 2],
      ["z", 3],
    ]);
    Object.defineProperty(map, "size", { value: 1 });
    expect(map).toMatchInlineSnapshot(`
      Map {
        "x" => 1,
        "y" => 2,
        "z" => 3,
      }
    `);
  });

  // An iterator that never ends runs in a child process. The child exits with code 2 past
  // 1000 steps, so a printer with no bound fails this test fast and does not hang it.
  test.concurrent.each([
    {
      name: "Map",
      entry: "[steps, steps]",
      received: `new Map([["a", 1], ["b", 2]])`,
      printed: ["+   1 => 1,", "+   2 => 2,"],
    },
    {
      name: "Set",
      entry: "steps",
      received: `new Set(["a", "b"])`,
      printed: ["+   1,", "+   2,"],
    },
  ])("$name: a replaced prototype[Symbol.iterator] that never ends", async ({ name, entry, received, printed }) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
let steps = 0;
const original = ${name}.prototype[Symbol.iterator];
${name}.prototype[Symbol.iterator] = function* () {
  for (;;) {
    if (++steps > 1000) {
      console.log("RUNAWAY");
      process.exit(2);
    }
    yield ${entry};
  }
};
let message;
try {
  Bun.jest().expect(${received}).toEqual(new ${name}());
} catch (e) {
  message = e.message;
} finally {
  ${name}.prototype[Symbol.iterator] = original;
}
console.log(message);
console.log("steps:", steps);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: [
        "expect(received).toEqual(expected)",
        "",
        `- ${name} {}`,
        `+ ${name} {`,
        ...printed,
        "+ }",
        "",
        "- Expected  - 1",
        "+ Received  + 4",
        "",
        // Two entries, one more step that finds a third entry, then return().
        "steps: 3",
      ],
      exitCode: 0,
      signalCode: null,
    });
  });
});
