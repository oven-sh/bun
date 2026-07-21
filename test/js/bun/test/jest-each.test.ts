import { afterAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

describe("tagged template literal", () => {
  const seen: Array<{ a: unknown; b: unknown; expected: unknown }> = [];

  it.each`
    a      | b      | expected
    ${1}   | ${2}   | ${3}
    ${"x"} | ${"y"} | ${"xy"}
  `("adds $a + $b -> $expected", ({ a, b, expected }) => {
    seen.push({ a, b, expected });
    expect(typeof a).not.toBe("undefined");
    expect(a + b).toBe(expected);
  });

  const falsy: unknown[] = [];
  it.each`
    input
    ${null}
    ${undefined}
    ${0}
    ${false}
    ${""}
  `("passes falsy value through untouched", ({ input }) => {
    falsy.push(input);
  });

  afterAll(() => {
    expect(seen).toEqual([
      { a: 1, b: 2, expected: 3 },
      { a: "x", b: "y", expected: "xy" },
    ]);
    expect(falsy).toEqual([null, undefined, 0, false, ""]);
  });

  it("throws on a trailing partial row", () => {
    expect(
      () => it.each`
        a    | b
        ${1} | ${2}
        ${3}
      `,
    ).toThrow("Not enough arguments supplied for given headings");
  });
});

describe.each`
  multiplier | value | expected
  ${2}       | ${3}  | ${6}
  ${3}       | ${4}  | ${12}
`("describe.each tagged template: x$multiplier", ({ multiplier, value, expected }) => {
  it(`${multiplier} * ${value} = ${expected}`, () => {
    expect(multiplier * value).toBe(expected);
  });
});

test.each`
  input | output
  ${1}  | ${2}
  ${5}  | ${10}
`("test.each tagged template: $input -> $output", ({ input, output }) => {
  expect(input * 2).toBe(output);
});

test("tagged-template .each runs one test per data row with interpolated titles", async () => {
  using dir = tempDir("each-tagged-template", {
    "tagged.test.ts": `
      import { test, expect } from "bun:test";
      test.each\`
        a      | b      | expected
        \${1}   | \${2}   | \${3}
        \${"x"} | \${"y"} | \${"xy"}
      \`("adds $a + $b -> $expected", ({ a, b, expected }) => {
        expect(a + b).toBe(expected);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "tagged.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = stdout + stderr;
  expect(out).toContain("adds 1 + 2 -> 3");
  expect(out).toContain("adds x + y -> xy");
  expect(out).not.toContain("$a");
  expect(out).toMatch(/Ran 2 tests/);
  expect(exitCode).toBe(0);
});
