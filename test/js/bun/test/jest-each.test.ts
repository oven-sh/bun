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

// #24347: an array row that omits a trailing optional tuple element used to be
// spread as-is, so the per-row `done` arity check filled the omitted slot with
// the `done` callback. Jest does the same; Bun intentionally diverges so the
// callback parameter's inferred `T | undefined` type holds at runtime. Bound
// args are only padded when a `done` parameter actually follows, so a short
// row's `arguments.length` otherwise still matches the row's own length.
describe("ragged array rows bind optional trailing tuple elements as undefined (#24347)", () => {
  const cases: [number, number, number?][] = [
    [1, 2],
    [1, 2, undefined],
    [10, 0, 10],
  ];

  const seen: unknown[] = [];
  it.each(cases)("omitted optional element is undefined, not done [row %#]", (a, b, c) => {
    seen.push([a, b, c]);
    expect(typeof c).not.toBe("function");
  });
  it("bound every row with the omitted slot as undefined", () => {
    expect(seen).toEqual([
      [1, 2, undefined],
      [1, 2, undefined],
      [10, 0, 10],
    ]);
  });

  it.each(cases)("done still binds after the padded slot [row %#]", (_a, _b, c, done) => {
    expect(typeof c).not.toBe("function");
    expect(["number", "undefined"]).toContain(typeof c);
    expect(typeof done).toBe("function");
    (done as (err?: unknown) => void)();
  });

  it.each<[number, number?, number?]>([[1], [1, 2, 3]])(
    "done binds after two omitted optional slots [row %#]",
    (a, b, c, done) => {
      expect({ a, b: typeof b, c: typeof c, done: typeof done }).toEqual(
        a === 1 && b === undefined
          ? { a: 1, b: "undefined", c: "undefined", done: "function" }
          : { a: 1, b: "number", c: "number", done: "function" },
      );
      (done as (err?: unknown) => void)();
    },
  );

  it.each([[1], [2]])("uniformly short table still receives a real done [row %#]", (n, done) => {
    expect(typeof n).toBe("number");
    expect(typeof done).toBe("function");
    (done as (err?: unknown) => void)();
  });

  const restSeen: number[] = [];
  // fn.length = 0, so no `done` is ever appended and no padding happens: a short
  // row's bound arguments still reflect the row's own length, matching Jest and
  // Vitest.
  it.each([
    [1, 2],
    [1, 2, 3],
  ])("rest parameters reflect the row's own length [row %#]", (...row) => {
    restSeen.push(row.length);
    expect(row.every(v => typeof v !== "function")).toBe(true);
  });
  it("did not pad bound args when no done parameter follows", () => {
    expect(restSeen).toEqual([2, 3]);
  });
});
