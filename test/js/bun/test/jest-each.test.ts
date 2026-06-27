import { describe, expect, it, test } from "bun:test";
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

// %s and %i with a non-integer number were left as the literal specifier, and
// %p / $var produced multi-line test names, which corrupts the JUnit output.
test("title specifiers substitute every number and stay on one line", async () => {
  using dir = tempDir("jest-each-titles", {
    "titles.test.ts": `
      import { test } from "bun:test";
      test.each([[1.5]])("s=%s", () => {});
      test.each([[1.5]])("i=%i", () => {});
      test.each([[1.5]])("d=%d", () => {});
      test.each([[1.5]])("f=%f", () => {});
      test.each([[{ a: 1 }]])("p=%p", () => {});
      test.each([[{ a: 1 }]])("sobj=%s", () => {});
      test.each([{ a: { b: 2 } }])("var=$a", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "titles.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  for (const title of ["s=1.5", "i=1", "d=1.5", "f=1.5", "p={ a: 1 }", "sobj={ a: 1 }", "var={ b: 2 }"]) {
    expect(stderr).toInclude(`(pass) ${title}`);
  }
  expect(stderr).toInclude("7 pass");
  expect(exitCode).toBe(0);
});
