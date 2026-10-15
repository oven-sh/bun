import { describe, expect, it } from "bun:test";
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

it("a cyclic row value under %j gives the title [Circular] and does not end the file", async () => {
  using dir = tempDir("jest-each-cyclic-title", {
    "cyclic.test.js": `
      import { describe, expect, test } from "bun:test";
      const c = { a: 1 }; c.self = c;
      test("plain", () => {});
      test.each([[c]])("j=%j", v => { expect(v).toBe(c); });
      test.each([[c]])("o=%o", v => { expect(v).toBe(c); });
      test.each([c])("row j=%j", v => { expect(v).toBe(c); });
      describe.each([[c]])("d=%j", v => { test("inner", () => { expect(v).toBe(c); }); });
      test.skip.each([[c]])("skipped j=%j", () => {});
      test.todo.each([[c]])("todo j=%j", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "cyclic.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Jest prints the inspect form for %o, so the text after "o=" is not asserted: only that the row runs.
  const results = stderr
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, "").replace(/^(\(pass\) o=).*$/, "$1<value>"));
  expect({ results, exitCode }).toEqual({
    results: [
      "(pass) plain",
      "(pass) j=[Circular]",
      "(pass) o=<value>",
      "(pass) row j=[Circular]",
      "(pass) d=[Circular] > inner",
      "(skip) skipped j=[Circular]",
      "(todo) todo j=[Circular]",
    ],
    exitCode: 0,
  });
});
