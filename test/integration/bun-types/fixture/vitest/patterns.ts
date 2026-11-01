import type { ExpectStatic, Mock, Mocked, MockedClass, MockedFunction, MockedObject, MockInstance, TestContext } from "vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, test, vi } from "vitest";
import * as math from "./math";

// Context type passed as a type argument
interface Local {
  token: string;
}
beforeEach<Local>(context => {
  context.token = "a";
  expectTypeOf(context.task.name).toBeString();
});
afterEach<Local>(({ token }) => void token);
it<Local>("reads what the hook set", ({ token, expect }) => {
  expect(token).toBe("a");
});
test<Local>("with options", { timeout: 1 }, ({ token }) => void token);
test.skip<Local>("chained", ({ token }) => void token);
beforeEach((context: TestContext & Local) => void context.token);
beforeAll(async () => {
  await Promise.resolve();
});

function overloaded(value: string): string;
function overloaded(value: number): number;
function overloaded(value: unknown): unknown {
  return value;
}
function generic<T>(value: T): T {
  return value;
}
abstract class Shape {
  abstract area(): number;
  describe(): string {
    return `${this.area()}`;
  }
}
class Account {
  private balance = 0;
  protected owner = "a";
  readonly id: string = "1";
  deposit(amount: number): this {
    this.balance += amount;
    return this;
  }
  async statement(): Promise<string[]> {
    return [this.owner];
  }
  get total(): number {
    return this.balance;
  }
  find<T>(fallback: T): T {
    return fallback;
  }
}
function audit(account: Account): string {
  return account.id;
}
interface Client {
  get(url: string): Promise<{ status: number; body: string }>;
  post(url: string, body?: unknown): Promise<void>;
  retries: number;
  onError?: (error: Error) => void;
  nested: { close(): void };
}

describe("casts", () => {
  (math.add as Mock).mockReturnValue(1);
  (math.add as Mock<typeof math.add>).mockReturnValue(1);
  (math.add as unknown as Mock).mockReturnValue("anything");
  (math.add as MockedFunction<typeof math.add>).mockReturnValue(1);
  (globalThis.fetch as Mock).mockResolvedValue(new Response());
  (console.log as unknown as MockInstance).mockRestore();
  const account = new Account() as Mocked<Account>;
  account.deposit.mockReturnThis();
  account.statement.mockResolvedValue(["a"]);
  audit(account);
  const client = { get: vi.fn(), post: vi.fn(), retries: 0, nested: { close: vi.fn() } } as Mocked<Client>;
  client.get.mockResolvedValue({ status: 200, body: "" });
  client.post.mockResolvedValue();
  client.post.mockRejectedValue(new Error("no"));
  expectTypeOf(client.retries).toBeNumber();
  const useClient = (c: Client) => c.retries;
  useClient(client);
  const whole = math as Mocked<typeof math>;
  whole.add.mockReturnValue(1);
  const viaImport = math as Mocked<typeof import("./math")>;
  viaImport.add.mockReturnValue(1);
});

describe("declared first, assigned in a hook", () => {
  let plain: Mock;
  let typed: Mock<(id: string) => Promise<number>>;
  let spy: MockInstance;
  let typedSpy: MockInstance<typeof console.error>;
  let methodSpy: MockInstance<Account["deposit"]>;
  let client: Mocked<Client>;
  let fn: ReturnType<typeof vi.fn>;
  let spied: ReturnType<typeof vi.spyOn>;
  const bag: Record<string, Mock> = {};
  const list: MockInstance[] = [];
  beforeEach(() => {
    plain = vi.fn();
    plain = vi.fn(() => 1);
    plain = vi.fn().mockReturnValue(1);
    plain = vi.fn().mockResolvedValue({ ok: true });
    typed = vi.fn();
    typed = vi.fn(async id => id.length);
    typed = vi.fn().mockResolvedValue(1);
    spy = vi.spyOn(console, "error");
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
    spy = vi.spyOn(Account.prototype, "deposit");
    typedSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    methodSpy = vi.spyOn(Account.prototype, "deposit");
    client = { get: vi.fn(), post: vi.fn(), retries: 0, nested: { close: vi.fn() } };
    fn = vi.fn().mockReturnValue(1);
    spied = vi.spyOn(Account.prototype, "statement").mockResolvedValue([]);
    spied = vi.spyOn(globalThis, "fetch");
    bag.a = vi.fn();
    list.push(spy, typedSpy, plain, vi.fn());
  });
  afterEach(() => {
    spy.mockRestore();
    list.forEach(mock => mock.mockReset());
    void [plain, typed, methodSpy, client, fn, spied];
  });
  it("passes mocks where functions are expected", () => {
    const run = (callback: (id: string) => Promise<number>) => callback("a");
    run(typed);
    run(plain);
    [1].forEach(plain);
    const props: { onChange: (value: string) => void; onClose?: () => void } = { onChange: vi.fn(), onClose: vi.fn() };
    props.onChange("a");
    expect(props.onChange).toHaveBeenCalledWith("a");
    expect(vi.mocked(props.onChange).mock.calls[0]![0]).toBe("a");
    expectTypeOf(typed.mock.calls).toEqualTypeOf<[id: string][]>();
    expectTypeOf(typed.mock.results[0]!.value).toBeAny();
    expectTypeOf(plain.mock.calls).toEqualTypeOf<any[][]>();
  });
});

describe("vi.fn", () => {
  const inferred = vi.fn((a: string, b?: number) => a.length + (b ?? 0));
  expectTypeOf(inferred).parameters.toEqualTypeOf<[a: string, b?: number]>();
  expectTypeOf(inferred("a")).toBeNumber();
  const ofOverloaded = vi.fn(overloaded);
  ofOverloaded.mockReturnValue(1);
  const ofGeneric = vi.fn(generic);
  ofGeneric.mockReturnValue(1);
  const ofClass = vi.fn(Account);
  expectTypeOf(new ofClass()).toEqualTypeOf<Account>();
  ofClass.mockImplementation(function (this: Account) {});
  ofClass.mockImplementation(class extends Account {});
  expectTypeOf(ofClass.mock.instances).toEqualTypeOf<Account[]>();
  const withThis = vi.fn(function (this: Account, amount: number) {
    return this.deposit(amount);
  });
  expectTypeOf(withThis.mock.contexts).toEqualTypeOf<Account[]>();
  const nothing = vi.fn<() => void>();
  nothing.mockReturnValue();
  nothing.mockImplementation(() => {});
  const never = vi.fn<() => never>();
  never.mockImplementation(() => {
    throw new Error("no");
  });
  const promised = vi.fn<() => Promise<void>>().mockResolvedValue();
  expectTypeOf(promised()).toEqualTypeOf<Promise<void>>();
  const chained = vi.fn<(n: number) => string>().mockReturnValueOnce("a").mockReturnValueOnce("b").mockReturnValue("c");
  expectTypeOf(chained(1)).toBeString();
  const withImplementation: Mock<() => number> = vi.fn(() => 1).withImplementation(
    () => 2,
    () => {},
  );
  void withImplementation;
  // @ts-expect-error
  vi.fn<(n: number) => string>().mockReturnValue(1);
  // @ts-expect-error
  vi.fn<(n: number) => string>().mockImplementation(() => 1);
  // @ts-expect-error
  vi.fn<(n: number) => string>()("1");
});

describe("vi.spyOn", () => {
  const account = new Account();
  vi.spyOn(account, "deposit").mockReturnThis();
  vi.spyOn(account, "statement").mockResolvedValue(["a"]);
  vi.spyOn(account, "total", "get").mockReturnValue(1);
  vi.spyOn(account, "find").mockReturnValue(1);
  vi.spyOn(Shape.prototype, "describe").mockReturnValue("a");
  vi.spyOn(math, "add").mockReturnValue(1);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(JSON, "parse").mockImplementation(() => ({}));
  vi.spyOn(window, "addEventListener");
  vi.spyOn(window.localStorage, "getItem").mockReturnValue(null);
  vi.spyOn(Storage.prototype, "setItem");
  vi.spyOn(document, "querySelector").mockReturnValue(null);
  vi.spyOn({ Account }, "Account").mockImplementation(function () {});
  const optional: Client = { get: async () => ({ status: 1, body: "" }), post: async () => {}, retries: 0, nested: { close() {} } };
  vi.spyOn(optional, "onError").mockImplementation(error => void error.message);
  expectTypeOf(vi.spyOn(account, "statement")).toEqualTypeOf<Mock<() => Promise<string[]>>>();
  // @ts-expect-error
  vi.spyOn(account, "nothing");
  // @ts-expect-error
  vi.spyOn(account, "id");
  // @ts-expect-error
  vi.spyOn(account, "statement").mockResolvedValue("a");
});

describe("vi.mocked", () => {
  const client = {} as Client;
  vi.mocked(client.get).mockResolvedValue({ status: 200, body: "" });
  vi.mocked(client).get.mockResolvedValue({ status: 200, body: "" });
  vi.mocked(client, true).nested.close.mockReturnValue();
  vi.mocked(client.get, { partial: true }).mockResolvedValue({ status: 200 });
  vi.mocked(overloaded).mockReturnValue(1);
  vi.mocked(generic).mockReturnValue(1);
  vi.mocked(Account).mockImplementation(function () {});
  vi.mocked(Account.prototype.deposit).mockReturnThis();
  vi.mocked(math).add.mockReturnValue(1);
  vi.mocked(fetch).mockResolvedValue(new Response());
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
  expectTypeOf(vi.mocked(client.retries)).toBeNumber();
  // @ts-expect-error
  vi.mocked(client.get).mockResolvedValue({ status: 200 });
  // @ts-expect-error
  vi.mocked(client).nested.close.mockReturnValue();
});

describe("the named types", () => {
  const ofFetch: MockedFunction<typeof fetch> = vi.fn();
  ofFetch.mockResolvedValue(new Response());
  const ofAccount: MockedObject<Account> = vi.mocked(new Account());
  ofAccount.deposit.mockReturnThis();
  const OfClass: MockedClass<typeof Account> = vi.mocked(Account) as MockedClass<typeof Account>;
  OfClass.mockClear();
  OfClass.prototype.statement.mockResolvedValue([]);
  expectTypeOf(OfClass.mock.instances[0]!).toEqualTypeOf<Account>();
  expectTypeOf(OfClass.mock.calls[0]!).toEqualTypeOf<[]>();
  const check = (expect: ExpectStatic, value: unknown) => expect(value).toBeDefined();
  test("an expect passed along", context => check(context.expect, 1));
  check(expect, 1);
  const helper = ({ task, onTestFinished }: TestContext) => onTestFinished(() => void task.name);
  test("a context passed along", helper);
  test("a context passed along by hand", context => helper(context));
});

describe("loose expected values", () => {
  const text: string = "a";
  const maybe: string | null = null;
  expect(text).toBe(1);
  expect(text).toBe(null);
  expect(text).toBe(undefined);
  expect(maybe).toEqual({ any: "thing" });
  expect({ a: 1 }).toEqual({ a: "1", b: 2 });
  expect({ a: 1 }).toStrictEqual({ b: 2 });
  expect([1, 2]).toContain("a");
  expect([1, 2]).toContainEqual({ a: 1 });
  expect({ a: { b: 1 } }).toHaveProperty("a.b", "1");
  expect({ a: { b: 1 } }).toHaveProperty(["a", "b"]);
  expect([1]).toHaveProperty([0]);
  // @ts-expect-error
  expect([1]).toHaveProperty(0);
  expect({ a: 1 }).toMatchObject({ b: expect.any(String) });
  expect([{ a: 1 }]).toMatchObject([{ b: 1 }]);
  expect(text).toHaveLength(1);
  expect(1).toBeGreaterThan(1n);
  expect(new Account()).toBeInstanceOf(Account);
  expect(text).toMatch(/a/);
  expect(() => {}).toThrow(Error);
  expect(() => {}).toThrow(expect.objectContaining({ message: "a" }));
  expect(1).toBeCloseTo(1, 2);
  expect<number>(1).toBe(1);
});
