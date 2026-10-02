import { describe, expect, it } from "bun:test";

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

// Regression for oven-sh/bun#24347: a row that omits an optional trailing tuple
// element was treated as wanting `done`, so the callback received the `done`
// function in that slot (and the test then timed out). Short array rows are now
// padded to the table's widest row before `done` is appended, matching
// describe.each.
describe("optional trailing tuple elements (#24347)", () => {
  it.each([
    [1, 2],
    [1, 2, undefined],
    [10, 0, 10],
  ])("omitted optional element is undefined, not the done callback [row %#]", (a, b, c) => {
    expect(typeof c).not.toBe("function");
  });

  it.each([
    [1, 2],
    [1, 2, undefined],
    [10, 0, 10],
  ])("done still fires after an omitted optional element [row %#]", (_a, _b, c, done) => {
    expect(typeof c).not.toBe("function");
    expect(["number", "undefined"]).toContain(typeof c);
    expect(typeof done).toBe("function");
    done();
  });

  it.each([[1], [2]])("a real done callback still fires for a uniformly short table", (n, done) => {
    expect(typeof done).toBe("function");
    done();
  });

  // `done` accounting is per row: a padded array row uses its (normalized) width,
  // a scalar row stays a single argument.
  it.each([[1, 2, 3], 5])("mixed scalar and array rows keep per-row done accounting [row %#]", (value, maybeDone) => {
    if (typeof maybeDone === "function") {
      expect(value).toBe(5); // scalar row: second param is the done callback
      maybeDone();
    } else {
      expect(value).toBe(1); // array row: second param is the array's value, not done
      expect(maybeDone).toBe(2);
    }
  });
});
