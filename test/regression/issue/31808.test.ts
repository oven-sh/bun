// https://github.com/oven-sh/bun/issues/31808
//
// `console.dir(arr, { maxArrayLength: N })` and `Bun.inspect(arr, { maxArrayLength: N })`
// ignored the `maxArrayLength` option: the native formatter always truncated
// arrays at a hardcoded cap of 100 items regardless of the value passed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

const makeArray = (length: number) => Array.from({ length }, (_, i) => i);

test("Bun.inspect honors maxArrayLength (truncation)", () => {
  const arr = makeArray(200);
  expect(Bun.inspect(arr, { maxArrayLength: 5 })).toMatchInlineSnapshot(`
    "[
      0, 1, 2, 3, 4,
      ... 195 more items
    ]"
  `);
});

test("Bun.inspect maxArrayLength larger than the array prints everything", () => {
  const arr = makeArray(150);
  const out = Bun.inspect(arr, { maxArrayLength: 200 });
  expect(out).toContain("149");
  expect(out).not.toContain("more items");
});

test("Bun.inspect maxArrayLength shorter than the default truncates below 100", () => {
  const arr = makeArray(50);
  expect(Bun.inspect(arr, { maxArrayLength: 3 })).toMatchInlineSnapshot(`
    "[
      0, 1, 2,
      ... 47 more items
    ]"
  `);
});

test("Bun.inspect maxArrayLength: 0 elides every element", () => {
  expect(Bun.inspect([1, 2, 3], { maxArrayLength: 0 })).toBe("[ ... 3 more items ]");
});

test("Bun.inspect maxArrayLength negative clamps to 0", () => {
  expect(Bun.inspect([1, 2, 3], { maxArrayLength: -5 })).toBe("[ ... 3 more items ]");
});

test("Bun.inspect maxArrayLength: null means no limit", () => {
  const arr = makeArray(150);
  const out = Bun.inspect(arr, { maxArrayLength: null });
  expect(out).toContain("149");
  expect(out).not.toContain("more items");
});

test("Bun.inspect maxArrayLength: Infinity means no limit", () => {
  const arr = makeArray(150);
  const out = Bun.inspect(arr, { maxArrayLength: Infinity });
  expect(out).toContain("149");
  expect(out).not.toContain("more items");
});

test("Bun.inspect without maxArrayLength still defaults to 100", () => {
  const arr = makeArray(200);
  const out = Bun.inspect(arr);
  expect(out).toContain("... 100 more items");
  expect(out).not.toContain("101");
});

test("Bun.inspect maxArrayLength equal to the array length prints everything", () => {
  expect(Bun.inspect([1, 2, 3, 4, 5], { maxArrayLength: 5 })).toBe("[ 1, 2, 3, 4, 5 ]");
});

test("Bun.inspect uses singular 'item' when exactly one element is elided", () => {
  // in-loop truncation: 6 elements, cap 5 -> 1 remaining
  expect(Bun.inspect([1, 2, 3, 4, 5, 6], { maxArrayLength: 5 })).toMatchInlineSnapshot(`
    "[ 1, 2, 3, 4, 5,
      ... 1 more item ]"
  `);
  // maxArrayLength: 0 on a single-element array -> 1 remaining
  expect(Bun.inspect([1], { maxArrayLength: 0 })).toBe("[ ... 1 more item ]");
  // 2 remaining stays plural
  expect(Bun.inspect([1, 2], { maxArrayLength: 0 })).toBe("[ ... 2 more items ]");
});

test("Bun.inspect maxArrayLength still prints named own properties", () => {
  // maxArrayLength: 0 must not swallow non-index properties attached to the array.
  expect(Bun.inspect(Object.assign([1, 2, 3], { foo: "bar" }), { maxArrayLength: 0 })).toBe(
    '[ ... 3 more items, foo: "bar" ]',
  );
  // Truncating mid-array keeps trailing named properties too.
  expect(Bun.inspect(Object.assign([1, 2, 3, 4, 5], { foo: "bar" }), { maxArrayLength: 2 })).toMatchInlineSnapshot(`
    "[ 1, 2,
      ... 3 more items, foo: "bar" ]"
  `);
});

test("Bun.inspect maxArrayLength counts holes at the truncation boundary", () => {
  // A hole at the cap boundary belongs to the elided tail and must be counted
  // (3 remaining: the hole at index 1 plus indices 2 and 3), not leak into a
  // bogus trailing "empty items" summary.
  expect(Bun.inspect([1, , 3, 4], { maxArrayLength: 1 })).toMatchInlineSnapshot(`
    "[ 1,
      ... 3 more items ]"
  `);
  expect(Bun.inspect([1, 2, , , 5, 6], { maxArrayLength: 2 })).toMatchInlineSnapshot(`
    "[ 1, 2,
      ... 4 more items ]"
  `);
});

test("Bun.inspect maxArrayLength elides a leading hole without a dangling comma", () => {
  // When the array starts with a hole and the cap truncates immediately,
  // nothing precedes the elision, so no leading `,` should be emitted.
  expect(Bun.inspect([, 1, 2], { maxArrayLength: 1 })).toBe("[ ... 3 more items ]");
  expect(Bun.inspect([, , , 1], { maxArrayLength: 1 })).toBe("[ ... 4 more items ]");
});

test.concurrent("console.dir honors maxArrayLength", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const a = Array.from({length:200}, (_,i)=>i); console.dir(a, {maxArrayLength: 5});"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "[
      0, 1, 2, 3, 4,
      ... 195 more items
    ]"
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("console.dir maxArrayLength larger than the array prints everything", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const a = Array.from({length:150}, (_,i)=>i); console.dir(a, {maxArrayLength: 200});"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("149");
  expect(stdout).not.toContain("more items");
  expect(exitCode).toBe(0);
});

test.concurrent("node:console Console path still honors maxArrayLength", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      'const {Console}=require("node:console"); new Console(process.stdout).dir(Array.from({length:200},(_,i)=>i),{maxArrayLength:5});',
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"[ 0, 1, 2, 3, 4, ... 195 more items ]"`);
  expect(exitCode).toBe(0);
});
