import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  jest,
  type Matchers,
  mock,
  type Mock,
  spyOn,
  test,
  vi,
  xdescribe,
  xit,
  xtest,
} from "bun:test";
import { expectType } from "./utilities";

const hooks = [beforeAll, beforeEach, afterAll, afterEach];

for (const hook of hooks) {
  hook(() => {
    // ...
  });
  // eslint-disable-next-line
  hook(async () => {
    // ...
    return;
  });
  hook((done: (err?: unknown) => void) => {
    done();
    done(new Error());
    done("Error");
  });
}

describe("bun:test", () => {
  describe("expect()", () => {
    test("toThrow()", () => {
      function fail() {
        throw new Error("Bad");
      }
      expect(fail).toThrow();
      expect(fail).toThrow("Bad");
      expect(fail).toThrow(/bad/i);
      expect(fail).toThrow(Error);
      expect(fail).toThrow(new Error("Bad"));
    });
  });
  test("expect()", () => {
    expect(1).toBe(1);
    expect(1).not.toBe(2);
    // @ts-expect-error
    expect({ a: 1 }).toEqual<{ a: number }>({ a: 1, b: undefined });

    // @ts-expect-error
    expect({ a: 1 }).toEqual<{ a: number; b: number }>({ a: 1, b: undefined });

    // Support passing a type parameter to force exact type matching
    expect({ a: 1 }).toEqual<{ a: number; b: number }>({ a: 1, b: 1 });

    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect(new Set()).toHaveProperty("size");
    expect(new Uint8Array()).toHaveProperty("byteLength", 0);
    expect([]).toHaveLength(0);
    expect(["bun"]).toContain("bun");
    expect("hello").toContain("bun");
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
    expect(Math.PI).toBeGreaterThan(3.14);
    expect(Math.PI).toBeGreaterThan(3n);
    expect(Math.PI).toBeGreaterThanOrEqual(3.14);
    expect(Math.PI).toBeGreaterThanOrEqual(3n);
    expect(NaN).toBeNaN();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(undefined).not.toBeDefined();
  });
});

test.each([1, 2, 3])("test.each", a => {
  expectType<1 | 2 | 3>(a);
});

// inference should work when data is passed directly in
test.each([
  ["a", true, 5],
  ["b", false, 1234],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
describe.each([
  ["a", true, 5],
  ["b", false, 5],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
describe.each([
  ["a", true, 5],
  ["b", false, "asdf"],
])("test.each", (a, b, c) => {
  expectType<string>(a);
  expectType<boolean>(b);
  expectType<number | string>(c);
});
// @ts-expect-error
describe.each([{ asdf: "asdf" }, { asdf: "asdf" }])("test.each", (a, b, c) => {
  // this test was wrong because this describe.each call will only have one argument, not three.
  // it is now marked with ts-expect-error and the fixed test is below.
});
describe.each([{ asdf: "asdf" }, { asdf: "asdf" }])("test.each", a => {
  expectType<{ asdf: string }>(a);
});
test.each([{ asdf: "asdf" }, { asdf: "asdf" }])("test.each", (a, done) => {
  expectType<{ asdf: string }>(a);
  expectType<(err?: unknown) => void>(done);
});

// no inference on data
const data = [
  ["a", true, 5],
  ["b", false, "asdf"],
];

test.each(data)("test.each", (a, b, c) => {
  expectType<string | number | boolean | ((err?: unknown) => void)>(a);
  expectType<string | number | boolean | ((err?: unknown) => void)>(b);
  expectType<string | number | boolean | ((err?: unknown) => void)>(c);
});
describe.each(data)("test.each", (a, b, c) => {
  expectType<string | number | boolean>(a);
  expectType<string | number | boolean>(b);
  expectType<string | number | boolean>(c);
});

// as const
const dataAsConst = [
  ["a", true, 5],
  ["b", false, "asdf"],
] as const;

test.each(dataAsConst)("test.each", (...args) => {
  expectType<string>(args[0]);
  expectType<boolean>(args[1]);
  expectType<string | number>(args[2]);
});
describe.each(dataAsConst)("test.each", (...args) => {
  expectType<string>(args[0]);
  expectType<boolean>(args[1]);
  expectType<string | number>(args[2]);
});
describe.each(dataAsConst)("test.each", (a, b, c) => {
  expectType<"a" | "b">(a);
  expectType<boolean>(b);
  expectType<5 | "asdf">(c);
});

expect().pass();
expect().fail();

expectType(expect()).is<import("bun:test").Matchers<undefined>>();
expectType(expect<string>()).is<import("bun:test").Matchers<string | undefined>>();
expectType(expect("")).is<import("bun:test").Matchers<string>>();
expectType(expect<string>("")).is<import("bun:test").Matchers<string>>();
expectType(expect(undefined, "Fail message")).is<import("bun:test").Matchers<undefined>>();
expectType(expect<string>(undefined, "Fail message")).is<import("bun:test").Matchers<string | undefined>>();
expectType(expect("", "Fail message")).is<import("bun:test").Matchers<string>>();
expectType(expect<string>("", "Fail message")).is<import("bun:test").Matchers<string>>();

describe("Matcher Overload Type Tests", () => {
  const num = 1;
  const str = "hello";
  const numArr = [1, 2, 3];
  const strArr = ["a", "b", "c"];
  const mixedArr = [1, "a", true];
  const obj = { a: 1, b: "world", 10: true };
  const numSet = new Set([10, 20]);

  test("toBe", () => {
    expect(num).toBe(1);
    expect(str).toBe("hello");
    // @ts-expect-error - Type 'string' is not assignable to type 'number'.
    expect(num).toBe<number>("1");
    // @ts-expect-error - Type 'number' is not assignable to type 'string'.
    expect(str).toBe<string>(123);
    // @ts-expect-error - Type 'boolean' is not assignable to type 'number'.
    expect(num).toBe<number>(true);
    // @ts-expect-error - Too many arguments for specific overload
    expect(num).toBe<number>(1, 2);
    // @ts-expect-error - Expecting number, passed function
    expect(num).toBe<number>(() => {});
  });

  test("toEqual", () => {
    expect(numArr).toEqual([1, 2, 3]);
    expect(obj).toEqual({ a: 1, b: "world", 10: true });
    // @ts-expect-error - Type 'string' is not assignable to type 'number' at index 0.
    expect(numArr).toEqual<number[]>(["1", 2, 3]);
    // @ts-expect-error - Property 'c' is missing in type '{ a: number; b: string; 10: boolean; }'.
    expect(obj).toEqual<typeof obj>({ a: 1, b: "world", c: false });
    // @ts-expect-error - Type 'boolean' is not assignable to type 'number[]'.
    expect(numArr).toEqual<number[]>(true);
    // @ts-expect-error - Too many arguments for specific overload
    expect(numArr).toEqual<number[]>([1, 2], [3]);
    // @ts-expect-error - Expecting object, passed number
    expect(obj).toEqual<object>(123);
  });

  test("toStrictEqual", () => {
    expect(numArr).toStrictEqual([1, 2, 3]);
    expect(obj).toStrictEqual({ a: 1, b: "world", 10: true });
    // @ts-expect-error - Type 'string' is not assignable to type 'number' at index 0.
    expect(numArr).toStrictEqual<number[]>(["1", 2, 3]);
    // @ts-expect-error - Properties are missing
    expect(obj).toStrictEqual<typeof obj>({ a: 1 });
    // @ts-expect-error - Type 'boolean' is not assignable to type 'number[]'.
    expect(numArr).toStrictEqual<number[]>(true);
    // @ts-expect-error - Too many arguments for specific overload
    expect(numArr).toStrictEqual<number[]>([1, 2], [3]);
    // @ts-expect-error - Expecting object, passed number
    expect(obj).toStrictEqual<object>(123);
  });

  test("toBeOneOf", () => {
    expect(num).toBeOneOf([1, 2, 3]);
    expect(str).toBeOneOf(strArr);
    expect(num).toBeOneOf(numSet);
    // @ts-expect-error - Argument of type 'number[]' is not assignable to parameter of type 'Iterable<string>'.
    expect(str).toBeOneOf<Iterable<string>>(numArr);
    // @ts-expect-error - Argument of type 'string[]' is not assignable to parameter of type 'Iterable<number>'.
    expect(num).toBeOneOf<Iterable<number>>(strArr);
    // @ts-expect-error - Argument of type 'Set<number>' is not assignable to parameter of type 'Iterable<string>'.
    expect(str).toBeOneOf<Iterable<string>>(numSet);
    // @ts-expect-error - Argument must be iterable
    expect(num).toBeOneOf<number>(1);
    // @ts-expect-error - Expecting string iterable, passed number iterable
    expect(str).toBeOneOf<Iterable<string>>([1, 2, 3]);
  });

  test("toContainKey", () => {
    expect(obj).toContainKey("a");
    expect(obj).toContainKey("b");
    // @ts-expect-error simple check for key does not exist
    expect(obj).toContainKey("c");
    expect(obj).toContainKey(10); // object key is number
    // @ts-expect-error - Argument of type '"c"' is not assignable to parameter of type 'number | "a" | "b"'.
    expect(obj).toContainKey<typeof obj>("c");
    // @ts-expect-error - Argument of type 'boolean' is not assignable to parameter of type 'string | number'.
    expect(obj).toContainKey<typeof obj>(true);
    // @ts-expect-error - Too many arguments for specific overload
    expect(obj).toContainKey<typeof obj>("a", "b");
    // @ts-expect-error - Argument of type 'symbol' is not assignable to parameter of type 'string | number'.
    expect(obj).toContainKey<typeof obj>(Symbol("a"));
  });

  test("toContainAllKeys", () => {
    expect(obj).toContainAllKeys(["a", "b"]);
    expect(obj).toContainAllKeys([10, "a"]);
    // @ts-expect-error simple check for key does not exist
    expect(obj).toContainAllKeys(["c"]);
    // @ts-expect-error - Type '"c"' is not assignable to type 'number | "a" | "b"'.
    expect(obj).toContainAllKeys<(typeof obj)[]>(["a", "c"]);
    // @ts-expect-error - Type 'boolean' is not assignable to type 'string | number'.
    expect(obj).toContainAllKeys<(typeof obj)[]>(["a", true]);
    // @ts-expect-error - Argument must be an array
    expect(obj).toContainAllKeys<Array<typeof obj>>("a");
    // @ts-expect-error - Array element type 'symbol' is not assignable to 'string | number'.
    expect(obj).toContainAllKeys<(typeof obj)[]>(["a", Symbol("b")]);
  });

  test("toContainAnyKeys", () => {
    expect(obj).toContainAnyKeys(["a", "b", 10]);
    // @ts-expect-error simple check for key does not exist
    expect(obj).toContainAnyKeys(["c"]);
    // @ts-expect-error - 11 is not a key
    expect(obj).toContainAnyKeys(["a", "b", 11]);
    // @ts-expect-error - c is not a key
    expect(obj).toContainAnyKeys(["a", "c"]); // c doesn't exist, but 'a' does
    // @ts-expect-error d is not a key
    expect(obj).toContainAnyKeys([10, "d"]);
    // @ts-expect-error - Type '"c"' is not assignable to type 'number | "a" | "b"'. Type '"d"' is not assignable to type 'number | "a" | "b"'.
    expect(obj).toContainAnyKeys<(typeof obj)[]>(["c", "d"]);
    // @ts-expect-error - Type 'boolean' is not assignable to type 'string | number'.
    expect(obj).toContainAnyKeys<(typeof obj)[]>([true, false]);
    // @ts-expect-error - Argument must be an array
    expect(obj).toContainAnyKeys<Array<typeof obj>>("a");
    // @ts-expect-error - Array element type 'symbol' is not assignable to 'string | number'.
    expect(obj).toContainAnyKeys<(typeof obj)[]>([Symbol("a")]);
  });

  test("toContainKeys", () => {
    // Alias for toContainAllKeys
    expect(obj).toContainKeys(["a", "b"]);
    expect(obj).toContainKeys([10, "a"]);
    // @ts-expect-error simple check for key does not exist
    expect(obj).toContainKeys(["c"]);
    // @ts-expect-error - Type '"c"' is not assignable to type 'number | "a" | "b"'.
    expect(obj).toContainKeys<(typeof obj)[]>(["a", "c"]);
    // @ts-expect-error - Type 'boolean' is not assignable to type 'string | number'.
    expect(obj).toContainKeys<(typeof obj)[]>(["a", true]);
    // @ts-expect-error - Argument must be an array
    expect(obj).toContainKeys<Array<typeof obj>>("a");
    // @ts-expect-error - Array element type 'symbol' is not assignable to 'string | number'.
    expect(obj).toContainKeys<(typeof obj)[]>(["a", Symbol("b")]);
  });

  test("toContainEqual", () => {
    expect(mixedArr).toContainEqual(1);
    expect(mixedArr).toContainEqual("a");
    expect(mixedArr).toContainEqual(true);
    // @ts-expect-error - Argument of type 'null' is not assignable to parameter of type 'string | number | boolean'.
    expect(mixedArr).toContainEqual<string | number | boolean>(null);
    // @ts-expect-error - Argument of type 'number[]' is not assignable to parameter of type 'string | number | boolean'.
    expect(mixedArr).toContainEqual<string | number | boolean>(numArr);
    // @ts-expect-error - Too many arguments for specific overload
    expect(mixedArr).toContainEqual<string | number | boolean>(1, 2);
    // @ts-expect-error - Expecting string | number | boolean, got object
    expect(mixedArr).toContainEqual<string | number | boolean>({ a: 1 });
  });
});

const mySpyOnObjectWithOptionalMethod: {
  optionalMethod?: (input: { question: string }) => { answer: string };
} = {
  optionalMethod: input => ({ answer: `Aswer to ${input.question}` }),
};

const mySpiedMethodOfOptional = spyOn(mySpyOnObjectWithOptionalMethod, "optionalMethod");
mySpiedMethodOfOptional({ question: "asdf" });
expectType<Mock<(input: { question: string }) => { answer: string }>>(mySpiedMethodOfOptional);

const myNormalSpyOnObject = {
  normalMethod: (name: string) => `Hello ${name}`,
};

const myNormalSpiedMethod = spyOn(myNormalSpyOnObject, "normalMethod");
myNormalSpiedMethod("asdf");
expectType<Mock<(name: string) => string>>(myNormalSpiedMethod);

const spy = spyOn(console, "log");
expectType(spy.mock.calls).is<any[][]>();

jest.spyOn(console, "log");
jest.fn(() => 123 as const);

expectType(jest.useFakeTimers({ now: new Date(0), doNotFake: ["performance"], advanceTimers: 20, timerLimit: 100 })).is<
  typeof jest
>();
expectType(
  vi.useFakeTimers({
    now: 0,
    toFake: ["setTimeout", "Date"],
    shouldAdvanceTime: true,
    advanceTimeDelta: 20,
    loopLimit: 100,
  }),
).is<typeof vi>();
jest.useFakeTimers("legacy");
// @ts-expect-error
vi.useFakeTimers({ toFake: ["setTimeOut"] });
expectType(jest.advanceTimersByTimeAsync(1)).is<Promise<void>>();
expectType(jest.advanceTimersToNextTimerAsync(2)).is<Promise<void>>();
expectType(jest.runAllTimersAsync()).is<Promise<void>>();
expectType(jest.runOnlyPendingTimersAsync()).is<Promise<void>>();
expectType(vi.advanceTimersByTimeAsync(1)).is<Promise<typeof vi>>();
expectType(vi.advanceTimersToNextTimerAsync()).is<Promise<typeof vi>>();
expectType(vi.runAllTimersAsync()).is<Promise<typeof vi>>();
expectType(vi.runOnlyPendingTimersAsync()).is<Promise<typeof vi>>();
expectType(vi.advanceTimersToNextTimer(2).advanceTimersToNextFrame().runAllTicks()).is<typeof vi>();
expectType(jest.advanceTimersToNextTimer(2).advanceTimersToNextFrame().runAllTicks().runAllImmediates()).is<
  typeof jest
>();
vi.setTimerTickMode("nextTimerAsync").setTimerTickMode("interval", 5).setTimerTickMode("manual");
// @ts-expect-error
vi.setTimerTickMode("manual", 5);
jest.setTimerTickMode({ mode: "interval", delta: 5 }).setTimerTickMode({ mode: "nextAsync" });
expectType(vi.setSystemTime("2020-01-01T00:00:00.000Z")).is<typeof vi>();
jest.setSystemTime("2020-01-01T00:00:00.000Z");
expectType(vi.getMockedSystemTime()).is<Date | null>();
expectType(vi.getRealSystemTime()).is<number>();
expectType(jest.getRealSystemTime()).is<number>();

xtest("", () => {});
xdescribe("", () => {});
xit("", () => {});

test("expectTypeOf basic type checks", () => {
  expectTypeOf({ name: "test" }).toMatchObjectType<{ name: string }>();

  // @ts-expect-error
  expectTypeOf({ name: 123 }).toMatchObjectType<{ name: string }>();
});

mock.clearAllMocks();

test
  .each([
    [1, 2, 3],
    [4, 5, 6],
  ])
  .todo("test.each", (a, b, c, done) => {
    expectType<number>(a);
    expectType<number>(b);
    expectType<number>(c);
    expectType<(err?: unknown) => void>(done);
  });
describe.each([
  [1, 2, 3],
  [4, 5, 6],
])("describe.each", (a, b, c) => {
  expectType<number>(a);
  expectType<number>(b);
  expectType<number>(c);
});

declare let mylist: number[];
describe.each(mylist)("describe.each", a => {
  expectTypeOf(a).toBeNumber();
});
test.each(mylist)("test.each", (a, done) => {
  expectTypeOf(a).toBeNumber();
  expectType<(err?: unknown) => void>(done);
});

// Advanced use case tests for #18511:

// 1. => When assignable to, we should pass (e.g. new Set() is assignable to Set<string>).
//       But when unassigbale, we should type error (e.g `string` is not assignable to `"bun"`)
// 2. => Expect that exact matches pass
// 3. => Expect that when we opt out of type safety, any value can be passed

declare const input: "bun" | "baz" | null;
declare const expected: string;

// @ts-expect-error
/** 1. **/ expect(input).toBe(expected); // Type error - string is not assignable to `'bun' | ...`
/** 2. **/ expect(input).toBe("bun"); // happy!
/** 3. **/ expect(input).toBe<string>(expected); // happy! We opted out of type safety for this expectation

declare const setOfStrings: Set<string>;
/** 1. **/ expect(setOfStrings).toBe(new Set()); // this is inferrable to Set<string> so this should pass
/** 2. **/ expect(setOfStrings).toBe(new Set<string>()); // exact, so we are happy!
/** 3. **/ expect(setOfStrings).toBe<Set<string>>(new Set()); // happy! We opted out of type safety for this expectation

// Cases for #24591
declare const unknownMatchers: Matchers<unknown>;
unknownMatchers.toContainKeys(["a", "b"]);
unknownMatchers.toContainAnyKeys(["a", "b"]);
unknownMatchers.toContainAllKeys(["a", "b"]);
unknownMatchers.toContainKey("a");
unknownMatchers.toContainEqual([""]);
unknownMatchers.toEqual(["a", "b"]);
unknownMatchers.toBeCloseTo(2);
unknownMatchers.toBe("a");

// test.for(), test.extend() and the test context
test.for([
  [1, "a"],
  [2, "b"],
] as const)("test.for", ([n, s], context) => {
  expectType<1 | 2>(n);
  expectType<"a" | "b">(s);
  expectType<string>(context.task.name);
  expectType<"run" | "pass" | "fail" | "skip">(context.task.result.state);
  expectType<AbortSignal>(context.signal);
  context.expect(n).toBeNumber();
  context.onTestFinished(({ task }) => {
    expectType<string>(task.fullName);
  });
  context.onTestFailed(async () => {}, 1000);
  context.skip(n === 1, "note");
});
test.for([1, 2])("test.for", { timeout: 100 }, (n, { expect }) => {
  expect(n).toBe(n);
});
describe.for([[1, 2]])("describe.for", row => {
  expectType<readonly [1, 2]>(row);
});
test.each`
  a    | b
  ${1} | ${2}
`("$a $b", ({ a, b }, done) => {
  expectType<any>(a + b);
  expectType<(err?: unknown) => void>(done);
});

const extended = test.extend<{ port: number; url: string; label: string }>({
  port: async ({}, use) => {
    await use(3000);
  },
  url: [
    async ({ port, task }, use) => {
      expectType<number>(port);
      expectType<string>(task.name);
      await use(`http://localhost:${port}`);
    },
    { auto: true, scope: "test" },
  ],
  label: "a value",
});
extended("test.extend", ({ port, url, label, task, expect }) => {
  expectType<number>(port);
  expectType<string>(url);
  expectType<string>(label);
  expectType<string>(task.name);
  expect(port).toBe(3000);
});
extended.skip("test.extend", { retry: 1 }, async ({ url }) => expectType<string>(url));
extended.concurrent.for([1])("test.extend", (row, { port }) => {
  expectType<number>(row + port);
});
extended.each([[1, "a"]] as const)("test.extend", (n, s) => {
  expectType<1>(n);
  expectType<"a">(s);
});
extended.beforeEach(({ port }) => {
  expectType<number>(port);
  return () => {};
});
extended.afterAll(({ port }, suite) => {
  expectType<number>(port);
  expectType<string>(suite.name);
});
extended.override({ label: "another" }).override({ port: async ({}, use) => use(1) });
// @ts-expect-error
extended.override({ label: 1 });
// @ts-expect-error
extended("test.extend", ({ nope }) => {});
// @ts-expect-error
test.extend<{ port: number }>({ port: "not a number" });

const further = extended.extend<{ port: string; extra: boolean }>({
  port: async ({ url }, use) => use(url),
  extra: true,
});
further("test.extend", ({ port, extra, label }) => {
  expectType<string>(port);
  expectType<boolean>(extra);
  expectType<string>(label);
});
const built = test
  .extend("one", 1)
  .extend("two", async ({ one }) => `${one}`)
  .extend("three", { scope: "file" }, ({}, { onCleanup }) => {
    onCleanup(async () => {});
    return true;
  });
built("test.extend", ({ one, two, three }) => {
  expectType<number>(one);
  expectType<string>(two);
  expectType<boolean>(three);
});
test.describe("test.describe", () => {
  test.beforeEach(() => {});
  test.afterAll(done => done());
});

// .resolves and .rejects
expectType(expect(Promise.resolve(1)).resolves.toBe(1)).is<Promise<void>>();
expectType(expect(Promise.resolve(1)).resolves.not.toBe(2)).is<Promise<void>>();
expectType(expect(Promise.resolve(1)).not.resolves.toBe(2)).is<Promise<void>>();
expectType(expect(Promise.reject(new Error())).rejects.toThrow()).is<Promise<void>>();
expectType(expect(async () => 1).resolves.toBe(1)).is<Promise<void>>();
expectType(expect(1).toBe(1)).is<void>();
expectType(expect(1).not.toBe(2)).is<void>();
// @ts-expect-error
expect(Promise.resolve(1)).resolves.toBe("1");
// @ts-expect-error
expect(async () => 1).resolves.toBe("1");

expectType(expect.soft(1, "message").toBe(1)).is<void>();
expectType(expect.soft(Promise.resolve(1)).resolves.not.toBe(2)).is<Promise<void>>();
// @ts-expect-error
expect.soft(1).toBe("1");

expectType(expect.poll(() => 1).toBe(1)).is<Promise<void>>();
expectType(expect.poll(async () => 1, { interval: 1, timeout: 10, message: "message" }).not.toBe(2)).is<
  Promise<void>
>();
// @ts-expect-error
expect.poll(async () => 1).toBe("1");
// @ts-expect-error
expect.poll(() => 1).toThrow();
// @ts-expect-error
expect.poll(() => 1).resolves;
// @ts-expect-error
expect.poll(1);
