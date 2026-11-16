import type {
  Assertion,
  AsymmetricMatchersContaining,
  ExpectStatic,
  MatcherState,
  Mock,
  MockContext,
  Mocked,
  MockedClass,
  MockedFunction,
  MockedObject,
  MockInstance,
  MockResult,
  MockSettledResult,
  OnTestFailedHandler,
  OnTestFinishedHandler,
  RunnerTask,
  RunnerTestCase,
  RunnerTestFile,
  RunnerTestSuite,
  SuiteAPI,
  TestAPI,
  TestContext,
  TestFunction,
  TestOptions,
  VitestUtils,
} from "vitest";
import {
  afterAll,
  afterEach,
  aroundAll,
  aroundEach,
  assertType,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  inject,
  it,
  onTestFailed,
  onTestFinished,
  suite,
  test,
  vi,
  vitest,
} from "vitest";
import { add } from "./math";

interface ElementMatchers<E, R> {
  toBeShown(): R;
  toHaveLabel(label: string | E): R;
}

declare module "vitest" {
  interface Matchers<R, T> {
    toBeWithin(floor: number, ceiling: number): R;
  }
  // Full type parameter list, an `extends` clause and an empty body.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends ElementMatchers<
    unknown,
    R
  > {}
  interface ExpectStatic {
    fromFixture(): string;
    (actual: Store, because: { reason: string }): Assertion;
  }
  interface ProvidedContext {
    port: number;
  }
  interface TaskMeta {
    owner?: string;
  }
  interface TestContext {
    requestId: string;
  }
}

class Store {
  constructor(public name: string) {}
  get(key: string): number {
    return key.length;
  }
  static open(name: string): Store {
    return new Store(name);
  }
}

const service = {
  load: (id: string) => Promise.resolve(id.length),
  nested: { ping: () => true },
  version: 1,
};

// Mock, MockInstance, and the return types of vi.fn() and vi.spyOn()
{
  const untyped: Mock = vi.fn();
  untyped(1, "2").anything;
  untyped.mockReturnValue("anything");

  const typed: Mock<typeof add> = vi.fn(add);
  expectTypeOf(typed(1, 2)).toBeNumber();
  typed.mockReturnValue(3).mockReturnValueOnce(4);
  typed.mockImplementation((a, b) => a - b).mockImplementationOnce(() => 0);
  expectTypeOf(typed.mock.calls[0]!).toEqualTypeOf<[a: number, b: number]>();
  expectTypeOf(typed.mock.lastCall).toEqualTypeOf<[a: number, b: number] | undefined>();
  typed.mockClear().mockReset().mockName("add");
  expectTypeOf(typed.getMockName()).toBeString();
  // @ts-expect-error
  typed.mockReturnValue("3");
  // @ts-expect-error
  typed("1", 2);

  const annotated = vi.fn<(id: string) => Promise<number>>();
  annotated.mockResolvedValue(1).mockResolvedValueOnce(2).mockRejectedValue(new Error("no")).mockRejectedValueOnce("no");
  expectTypeOf(annotated("a")).resolves.toBeNumber();
  // @ts-expect-error
  annotated.mockResolvedValue("1");

  let held: ReturnType<typeof vi.fn>;
  held = vi.fn();
  held = vi.fn(add);
  held = vi.fn(() => "text");
  held.mockReturnValue("anything");
  held.mockImplementation(() => 1);
  expect(held).toHaveBeenCalledWith(1, "2");

  let spy: ReturnType<typeof vi.spyOn>;
  spy = vi.spyOn(console, "log");
  spy = vi.spyOn(service, "load");
  spy.mockImplementation(() => {});
  spy.mockReturnValue(undefined);
  spy.mockRestore();
  spy.mock.calls.length;

  const bare: MockInstance = vi.spyOn(console, "warn");
  bare.mockImplementation(() => {});
  const instance: MockInstance<typeof service.load> = vi.spyOn(service, "load");
  instance.mockResolvedValue(1);
  const getter = vi.spyOn({ get size() { return 1; } }, "size", "get");
  getter.mockReturnValue(2);
  const setter = vi.spyOn({ set size(_: number) {} }, "size", "set");
  setter.mockImplementation(value => assertType<number>(value));
  vi.spyOn(Store.prototype, "get").mockReturnValue(1);
  vi.spyOn(Store, "open").mockReturnValue(new Store("a"));

  const context: MockContext<typeof add> = typed.mock;
  const result: MockResult<number> = context.results[0]!;
  if (result.type === "return") expectTypeOf(result.value).toBeNumber();
  const settled: MockSettledResult<number> = annotated.mock.settledResults[0]!;
  if (settled.type === "fulfilled") expectTypeOf(settled.value).toBeNumber();
  expectTypeOf(context.invocationCallOrder).toEqualTypeOf<number[]>();

  const holder: { log: Mock<(line: string) => void>; spy?: MockInstance<typeof console.log> } = { log: vi.fn() };
  holder.spy = vi.spyOn(console, "log");
  using disposed = vi.spyOn(console, "error");
  disposed.mockImplementation(() => {});
}

// Mocked, MockedFunction, MockedClass, MockedObject and vi.mocked()
{
  vi.mocked(add).mockReturnValue(1);
  vi.mocked(service.load).mockResolvedValue(1);
  vi.mocked(service).load.mockResolvedValue(1);
  vi.mocked(service, true).nested.ping.mockReturnValue(false);
  vi.mocked(service, { deep: true }).nested.ping.mockReturnValue(false);
  vi.mocked(Store).mockImplementation(function () {
    return new Store("mock");
  });
  vi.mocked(Store.open).mockReturnValue(new Store("a"));
  // @ts-expect-error
  vi.mocked(add).mockReturnValue("1");

  const mockedFunction: MockedFunction<typeof add> = vi.mocked(add);
  mockedFunction.mockReturnValue(1);
  expectTypeOf(mockedFunction(1, 2)).toBeNumber();
  const asFunction = add as MockedFunction<typeof add>;
  asFunction.mockReturnValueOnce(2);

  const mockedObject: MockedObject<typeof service> = vi.mocked(service);
  mockedObject.load.mockResolvedValue(2);
  expectTypeOf(mockedObject.version).toBeNumber();

  const mockedService = service as Mocked<typeof service>;
  mockedService.load.mockResolvedValue(3);
  expectTypeOf(mockedService.version).toBeNumber();
  const mockedStore = new Store("a") as Mocked<Store>;
  mockedStore.get.mockReturnValue(1);
  expectTypeOf(mockedStore.name).toBeString();
  const handMade: Mocked<Pick<Store, "get">> = { get: vi.fn() };
  handMade.get.mockReturnValue(1);

  const MockedStore = Store as MockedClass<typeof Store>;
  MockedStore.mockClear();
  MockedStore.prototype.get.mockReturnValue(1);
  MockedStore.mock.instances[0]!.name;
  new MockedStore("a").get("b");
}

// expect, Assertion, ExpectStatic, and matchers added through module augmentation
test("expect", async () => {
  const bare: Assertion = expect(1);
  bare.toBe(1);
  const ofString: Assertion<void, string> = expect("a");
  ofString.not.toBe("b");
  const asynchronous: Assertion<Promise<void>, number> = expect(Promise.resolve(1)).resolves;
  await asynchronous.toBe(1);
  const statics: ExpectStatic = expect;
  statics(1).toBe(1);
  expectTypeOf(expect.fromFixture()).toBeString();
  const asymmetric: AsymmetricMatchersContaining = expect;
  asymmetric.stringContaining("a");

  expect(new Store("a"), { reason: "a call signature that the project added" }).toBeDefined();
  expectTypeOf(expect(new Store("a"), { reason: "" })).toEqualTypeOf<Assertion>();
  expectTypeOf(expect(1).toBeShown()).toBeVoid();
  expectTypeOf(expect(1).not.toHaveLabel("a")).toBeVoid();
  expectTypeOf(expect(Promise.resolve(1)).resolves.toBeShown()).toEqualTypeOf<Promise<void>>();
  expect({ a: 1 }).toEqual({ a: expect.toHaveLabel("a") });

  expectTypeOf(expect(5).toBeWithin(1, 10)).toBeVoid();
  expectTypeOf(expect(5).not.toBeWithin(1, 10)).toBeVoid();
  expectTypeOf(expect.soft(5).toBeWithin(1, 10)).toBeVoid();
  expectTypeOf(expect(Promise.resolve(5)).resolves.toBeWithin(1, 10)).toEqualTypeOf<Promise<void>>();
  expectTypeOf(expect(Promise.reject(5)).rejects.not.toBeWithin(1, 10)).toEqualTypeOf<Promise<void>>();
  expectTypeOf(expect.poll(() => 5).toBeWithin(1, 10)).toEqualTypeOf<Promise<void>>();
  expect({ n: 5 }).toEqual({ n: expect.toBeWithin(1, 10) });
  expect({ n: 5 }).toEqual({ n: expect.not.toBeWithin(6, 10) });
  // @ts-expect-error
  expect(5).toBeWithin("1", 10);
  // @ts-expect-error
  expect(5).toBeSomethingNobodyDeclared();

  expect.extend({
    toBeWithin(received: number, floor: number, ceiling: number) {
      const state: MatcherState = this;
      expectTypeOf(state.isNot).toBeBoolean();
      expectTypeOf(this.equals(1, 1)).toBeBoolean();
      return { pass: received >= floor && received <= ceiling, message: () => this.utils.printReceived(received) };
    },
  });

  expect(1, "with a message").toBe(1);
  expect(add).toBeTypeOf("function");
  expect(1).toBeOneOf([1, 2]);
  expect(1).toSatisfy(n => n === 1);
  expect({ a: 1, b: 2 }).toMatchObject({ a: expect.any(Number) });
  expect([1]).toEqual(expect.arrayContaining([1]));
  expect("ab").toEqual(expect.stringMatching(/a/));
  expect({ a: 0.1 }).toEqual({ a: expect.closeTo(0.1, 2) });
  expect(() => {}).not.toThrow();
  expect(() => {}).not.toThrowError(/x/);
  expect({ a: 1 }).toMatchInlineSnapshot(`{ "a": 1 }`);
  expect({ a: 1 }).toMatchSnapshot();
  expect({ a: 1, at: new Date() }).toMatchSnapshot({ at: expect.any(Date) });
  await expect(Promise.reject(new Error("no"))).rejects.toThrow("no");
  await expect(service.load("a")).resolves.toBe(1);

  const mock = vi.fn(add);
  expect(mock).toHaveBeenCalled();
  expect(mock).toHaveBeenCalledOnce();
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith(1, expect.any(Number));
  expect(mock).toHaveBeenCalledExactlyOnceWith(1, 2);
  expect(mock).toHaveBeenLastCalledWith(1, 2);
  expect(mock).toHaveBeenNthCalledWith(1, 1, 2);
  expect(mock).toHaveBeenCalledBefore(vi.fn());
  expect(mock).toHaveBeenCalledAfter(vi.fn());
  expect(mock).toHaveReturned();
  expect(mock).toHaveReturnedWith(3);
  expect(mock).toHaveReturnedTimes(1);
  expect(mock).toHaveLastReturnedWith(3);
  expect(mock).toHaveNthReturnedWith(1, 3);
  expect(mock).toHaveResolved();
  expect(mock).toHaveResolvedWith(3);
  expect(mock).toHaveResolvedTimes(1);

  expect.assertions(1);
  expect.hasAssertions();
  expect.addEqualityTesters([(a, b) => (typeof a === "number" && typeof b === "number" ? a === b : undefined)]);
  expect.addSnapshotSerializer({ test: value => value instanceof Store, serialize: value => value.name });
  expectTypeOf(expect.getState().currentTestName).toEqualTypeOf<string | undefined>();
  expect.setState({ assertionCalls: 0 });
  if (Math.random() > 2) expect.unreachable("never");
});

// test, describe and hooks
{
  test("the context", async context => {
    const typed: TestContext = context;
    expectTypeOf(typed.requestId).toBeString();
    expectTypeOf(context.task.name).toBeString();
    expectTypeOf(context.signal).toEqualTypeOf<AbortSignal>();
    context.expect(5).toBeWithin(1, 10);
    context.task.meta.owner = "me";
    context.onTestFinished(() => {});
    context.onTestFailed(({ task }) => void task.name);
    await context.annotate("a note");
    await context.annotate("a note", "warning");
    context.skip(false, "not this time");
    context.skip("the rest");
  });
  test("destructured", ({ expect, task, skip, onTestFinished, requestId }) => {
    expect(task.name + requestId).toBeTypeOf("string");
    onTestFinished(() => {});
    skip();
  });
  test("options in the middle", { timeout: 100, retry: 2, repeats: 1 }, () => {});
  test("a timeout at the end", () => {}, 100);
  it("is test", async () => {});
  test.skip("skip", () => {});
  test.skip("skip without a function");
  test.only("only", () => {});
  test.todo("todo");
  test.fails("fails", () => {});
  test.concurrent("concurrent", async ({ expect }) => expect(1).toBe(1));
  test.skipIf(true)("skipIf", () => {});
  test.runIf(true)("runIf", () => {});
  test.concurrent.skip("chained", () => {});
  test.each([1, 2])("a number: %i", n => {
    expectTypeOf(n).toBeNumber();
  });
  test.each([
    [1, "a"],
    [2, "b"],
  ])("a tuple: %i %s", (n, s) => {
    expectTypeOf(n).toBeNumber();
    expectTypeOf(s).toBeString();
  });
  test.each([{ n: 1 }])("an object: $n", ({ n }) => {
    expectTypeOf(n).toBeNumber();
  });
  test.each`
    a    | b
    ${1} | ${2}
  `("a template: $a $b", ({ a, b }) => void (a + b));
  test.for([[1, 2]] as [number, number][])("for: %i %i", ([a, b], { expect }) => expect(a + b).toBe(3));
  test.for([{ n: 1 }])("for: $n", ({ n }, { task }) => void (n + task.name.length));

  const withFixtures = test.extend<{ port: number; url: string }>({
    port: 3000,
    url: async ({ port }, use) => {
      await use(`http://localhost:${port}`);
    },
  });
  withFixtures("fixtures", ({ port, url, task, requestId }) => {
    expectTypeOf(port).toBeNumber();
    expectTypeOf(url).toBeString();
    expectTypeOf(task.name + requestId).toBeString();
  });
  withFixtures.skip("chained", ({ url }) => void url);
  withFixtures.beforeEach(({ port }) => void port);
  withFixtures.afterEach(({ url }) => void url);
  const twice = withFixtures.extend<{ token: string }>({ token: [async ({ url }, use) => use(url), { auto: true }] });
  twice("both", ({ port, token }) => void (port + token.length));

  describe("a block", () => {});
  describe.skip("skip", () => {});
  describe.only("only", () => {});
  describe.todo("todo");
  describe.concurrent("concurrent", () => {});
  describe.skipIf(true)("skipIf", () => {});
  describe.runIf(true)("runIf", () => {});
  describe.each([1, 2])("each %i", n => {
    expectTypeOf(n).toBeNumber();
  });
  describe.each([{ n: 1 }])("each $n", ({ n }) => {
    expectTypeOf(n).toBeNumber();
  });
  describe.for([[1, 2]] as [number, number][])("for", ([a, b]) => void (a + b));
  describe(Store, () => {});
  suite("is describe", () => {});

  beforeAll(() => {});
  beforeAll(async () => {}, 1000);
  beforeAll(() => () => {});
  afterAll(async () => {});
  beforeEach(() => {});
  beforeEach(async context => {
    context.requestId = "1";
    expectTypeOf(context.task.name).toBeString();
  });
  beforeEach(() => () => {});
  beforeEach(() => async () => {}, 1000);
  afterEach(({ task }) => void task.result?.state);
  aroundEach(async (run, { task }) => {
    void task.name;
    await run();
  });
  aroundAll(async run => {
    await run();
  });
  onTestFinished(() => {});
  onTestFinished(async ({ task }) => void task.name);
  onTestFailed(({ task }) => void task.result?.errors);

  const body: TestFunction = ({ expect }) => expect(1).toBe(1);
  const withExtra: TestFunction<{ port: number }> = ({ port, task }) => void (port + task.name.length);
  test("a function declared elsewhere", body);
  withFixtures("another", withExtra);
  const options: TestOptions = { timeout: 1, retry: 1, repeats: 1 };
  test("options declared elsewhere", options, body);
  const failed: OnTestFailedHandler = ({ task }) => void task.name;
  const finished: OnTestFinishedHandler = async () => {};
  onTestFailed(failed);
  onTestFinished(finished);
  const testApi: TestAPI = test;
  const extendedApi: TestAPI<{ port: number; url: string }> = withFixtures;
  const suiteApi: SuiteAPI = describe;
  testApi("x", () => {});
  extendedApi("x", ({ port }) => void port);
  suiteApi("x", () => {});
  void inject("port");
  // @ts-expect-error
  inject("nothing provides this");
}

// RunnerTestCase, RunnerTestSuite and RunnerTestFile
test("tasks", ({ task }) => {
  const testCase: RunnerTestCase = task;
  const parent: RunnerTestSuite | undefined = testCase.suite;
  const file: RunnerTestFile = testCase.file;
  const nameOf = (task: RunnerTask) => task.name;
  nameOf(testCase);
  nameOf(file);
  if (parent) nameOf(parent);
  expectTypeOf(testCase.type).toEqualTypeOf<"test">();
  expectTypeOf(file.filepath).toBeString();
  expectTypeOf(testCase.meta.owner).toEqualTypeOf<string | undefined>();
  expectTypeOf(testCase.id).toBeString();
  expectTypeOf(testCase.fullName).toBeString();
  if (testCase.result?.state === "fail") void testCase.result.errors?.length;
  if (testCase.mode === "skip") return;
});

// vi
{
  const utils: VitestUtils = vi;
  utils.clearAllMocks();
  expectTypeOf(vitest).toEqualTypeOf<VitestUtils>();
  vi.clearAllMocks().resetAllMocks().restoreAllMocks();
  vi.useFakeTimers();
  vi.useFakeTimers({ now: 0, toFake: ["Date", "setTimeout"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(0)).setSystemTime(0).setSystemTime("2020-01-01");
  vi.advanceTimersByTime(1).advanceTimersToNextTimer().runAllTimers().runOnlyPendingTimers().runAllTicks();
  void vi.advanceTimersByTimeAsync(1).then(vi => vi.useRealTimers());
  void vi.runAllTimersAsync();
  void vi.runOnlyPendingTimersAsync();
  void vi.advanceTimersToNextTimerAsync();
  expectTypeOf(vi.getTimerCount()).toBeNumber();
  expectTypeOf(vi.isFakeTimers()).toBeBoolean();
  expectTypeOf(vi.getMockedSystemTime()).toEqualTypeOf<Date | null>();
  expectTypeOf(vi.getRealSystemTime()).toBeNumber();
  vi.clearAllTimers().useRealTimers();
  vi.stubGlobal("fetch", vi.fn()).unstubAllGlobals();
  vi.stubEnv("API_URL", "http://localhost").stubEnv("DEV", true).stubEnv("GONE", undefined).unstubAllEnvs();
  const hoisted = vi.hoisted(() => ({ add: vi.fn<typeof add>() }));
  hoisted.add.mockReturnValue(1);
  vi.mock("./math");
  vi.mock("./math", () => ({ add: hoisted.add }));
  vi.mock("./math", { spy: true });
  vi.mock("./math", async importOriginal => ({ ...(await importOriginal<typeof import("./math")>()), add: vi.fn() }));
  vi.mock(import("./math"), async importOriginal => {
    const original = await importOriginal();
    expectTypeOf(original.version).toBeNumber();
    return { ...original, add: vi.fn() };
  });
  vi.doMock("./math", () => ({}));
  vi.unmock("./math");
  vi.doUnmock("./math");
  void vi.importActual<typeof import("./math")>("./math").then(math => expectTypeOf(math.version).toBeNumber());
  void vi.importMock<typeof import("./math")>("./math").then(math => math.add.mockReturnValue(1));
  vi.resetModules();
  void vi.dynamicImportSettled();
  expectTypeOf(vi.isMockFunction(add)).toBeBoolean();
  const maybe: unknown = add;
  if (vi.isMockFunction(maybe)) maybe.mockClear();
  vi.mockObject(service).load.mockResolvedValue(1);
  void vi.waitFor(() => 1, { timeout: 10, interval: 1 }).then(n => expectTypeOf(n).toBeNumber());
  void vi.waitFor(async () => "a", 10).then(s => expectTypeOf(s).toBeString());
  void vi.waitUntil(() => (Math.random() > 0.5 ? "a" : null)).then(s => expectTypeOf(s).toBeString());
  vi.setConfig({ testTimeout: 1, hookTimeout: 1, clearMocks: true, mockReset: true, restoreMocks: true });
  vi.resetConfig();
}

assertType<number>(add(1, 2));
// @ts-expect-error
assertType<string>(add(1, 2));
