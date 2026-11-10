import { describe, expect, jest, mock, type Mock, type Mocked, spyOn, test, vi } from "bun:test";
import * as fs from "node:fs";
import { expectType } from "./utilities";

const mock1 = mock((arg: string) => {
  return arg.length;
});

const arg1 = mock1("1");
expectType<number>(arg1);
mock;

type arg2 = jest.Spied<() => string>;
declare var arg2: arg2;
arg2.mock.calls[0];
mock;

// @ts-expect-error
jest.fn<() => Promise<string>>().mockReturnValue("asdf");
// @ts-expect-error
jest.fn<() => string>().mockReturnValue(24);
jest.fn<() => string>().mockReturnValue("24");

jest.fn<() => Promise<string>>().mockResolvedValue("asdf");
// @ts-expect-error
jest.fn<() => string>().mockResolvedValue(24);
// @ts-expect-error
jest.fn<() => string>().mockResolvedValue("24");

jest.fn().mockClear();
jest.fn().mockReset();
jest.fn().mockRejectedValueOnce(new Error());

// `ReturnType<typeof spyOn>` must be usable for a spy that's declared before it's created.
let spy: ReturnType<typeof spyOn>;
spy = spyOn(console, "log");
expect(spy.mock.calls[0][0]).toBe("hello");
spy = spyOn(fs, "writeFileSync");
spy.mockImplementation((path: string, data: string) => {});
let jestSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(fs, "writeFileSync");
expect(jestSpy.mock.calls[0][1].length).toBe(1);
let viSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(fs, "writeFileSync");
expect(viSpy.mock.calls[0][1].length).toBe(1);
expectType<Parameters<typeof spyOn>["length"]>().is<2>();
expectType<ReturnType<typeof spyOn<DateConstructor, "now">>>().is<Mock<() => number>>();
expectType<ReturnType<typeof jest.spyOn<DateConstructor, "now">>>().is<Mock<() => number>>();
expectType<ReturnType<typeof vi.spyOn<DateConstructor, "now">>>().is<Mock<() => number>>();

// Same for `ReturnType<typeof mock>`.
expectType<ReturnType<typeof mock>>().is<Mock<(...args: any[]) => any>>();
expectType<ReturnType<typeof jest.fn>>().is<Mock<(...args: any[]) => any>>();
expectType<ReturnType<typeof vi.fn>>().is<Mock<(...args: any[]) => any>>();
expectType<ReturnType<typeof mock<(s: string) => number>>>().is<Mock<(s: string) => number>>();
expectType<ReturnType<typeof jest.fn<(s: string) => number>>>().is<Mock<(s: string) => number>>();
expectType<ReturnType<typeof vi.fn<(s: string) => number>>>().is<Mock<(s: string) => number>>();
const mockImplementation: Parameters<typeof mock>[0] = () => 1;
const jestImplementation: Parameters<typeof jest.fn>[0] = () => 1;
const viImplementation: Parameters<typeof vi.fn>[0] = () => 1;
expectType<Parameters<typeof vi.mock>[0]>().is<string>();
expectType<Parameters<typeof test.each>>().is<[table: readonly unknown[]]>();
expectType<Parameters<typeof describe.each>>().is<[table: readonly unknown[]]>();

// An `any` table must not resolve to the tagged-template overload.
test.each({} as any)("%s", (a, b, c) => {});
describe.each({} as any)("%s", (a, b) => {});

// Untyped parameters get a contextual `any`, so noImplicitAny doesn't reject them.
expectType(mock((a, b) => [a, b])).is<Mock<(a: any, b: any) => any[]>>();
expectType(jest.fn(a => a)).is<Mock<(a: any) => any>>();
expectType(vi.fn((a, ...rest) => rest.length)).is<Mock<(a: any, ...rest: any[]) => number>>();
expectType(mock({} as any)).is<Mock<any>>();
expectType(mock(Date)).is<Mock<DateConstructor>>();

class Repository {
  constructor(
    public url: string,
    public retries = 1,
  ) {}
  get size() {
    return 1;
  }
  set size(value: number) {}
  find(id: number) {
    return String(id);
  }
}
const repository = new Repository("url");

expectType(mock(Repository)).is<Mock<(url: string, retries?: number) => Repository>>();
expectType(jest.fn(Repository)).is<Mock<(url: string, retries?: number) => Repository>>();
expectType(vi.fn(Repository)).is<Mock<(url: string, retries?: number) => Repository>>();
expectType(new (mock(Repository))("url", 2)).is<Repository>();
// @ts-expect-error
new (mock(Repository))(1);

expectType(spyOn(repository, "find")).is<Mock<(id: number) => string>>();
expectType(spyOn(repository, "size", "get")).is<Mock<() => number>>();
expectType(spyOn(repository, "size", "set")).is<Mock<(value: number) => void>>();
expectType(jest.spyOn(repository, "size", "get")).is<Mock<() => number>>();
expectType(jest.spyOn(repository, "size", "set")).is<Mock<(value: number) => void>>();
expectType(vi.spyOn(repository, "size", "get")).is<Mock<() => number>>();
// @ts-expect-error
spyOn(repository, "size", "both");
// @ts-expect-error
spyOn(repository, "nope");

// `jest.mocked(value)` returns `value` itself, so `Mocked<T>` is still a `T`.
class Connection {
  #open = true;
  query(sql: string): string[] {
    return this.#open ? [sql] : [];
  }
}
class Store {
  private rows = new Map<number, string>();
  protected name = "store";
  private static count = 0;
  constructor(public connection: Connection) {
    Store.count++;
  }
  get(id: number): string | undefined {
    return this.rows.get(id);
  }
  static open(connection: Connection): Store {
    return new Store(connection);
  }
}
class Query {
  private clauses: string[] = [];
  where(clause: string): this {
    this.clauses.push(clause);
    return this;
  }
  all(): string[] {
    return this.clauses;
  }
}
class Box<Value> {
  constructor(public value: Value) {}
  unwrap(): Value {
    return this.value;
  }
  static of<Other>(value: Other): Box<Other> {
    return new Box(value);
  }
}
class Address {
  constructor(url: string);
  constructor(host: string, port: number);
  constructor(...parts: unknown[]) {}
  host(): string {
    return "";
  }
}
class Level {
  constructor(public kind: "debug") {}
  label(): string {
    return this.kind;
  }
}
function useStore(store: Store): Store {
  return store;
}
function pick<T>(value: T): T {
  return value;
}
function parse(input: string): string;
function parse(input: number): number;
function parse(input: string | number): string | number {
  return input;
}
function isText(value: unknown): value is string {
  return typeof value === "string";
}
function invariant(value: unknown): asserts value {
  if (!value) throw new Error("invariant");
}
interface Http {
  <T = unknown>(url: string): Promise<{ data: T }>;
  get<T = unknown>(url: string): Promise<{ data: T }>;
  create(): Http;
  interceptors: { request: { use(onRequest: (config: object) => object): number } };
}
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Grid = number | Grid[];
const client = { get: (id: number) => String(id), nested: { close: () => true }, retries: 3, started: new Date(0) };
const api = { pick, parse, isText, nested: { pick }, Store };
declare const store: Store;
declare const connection: Connection;
declare const query: Query;
declare const http: Http;
declare const unknownValue: unknown;
declare const stores: Store[];
declare const frozenStores: readonly Store[];
declare const pair: [Store, number];
declare const holder: {
  stores: Store[];
  maybe?: Store;
  either: Store | Query;
  config: Json;
  grid: Grid;
  load(): string;
};

useStore(jest.mocked(store));
useStore(vi.mocked(store));
useStore(vi.mockObject(store));
useStore(jest.createMockFromModule<{ store: Store }>("./store").store);
vi.importMock<{ store: Store }>("./store").then(module => useStore(module.store));
const sameConnection: Connection = jest.mocked(connection);
const sameClient: typeof client = jest.mocked(client);
const sameDate: Date = jest.mocked(new Date(0));
const samePromise: Promise<number> = jest.mocked(Promise.resolve(1));
const sameResponse: Response = vi.mocked(new Response("body"));
function sameValue<T>(value: T): T {
  return jest.mocked(value);
}
function unwrapped<T>(mocked: Mocked<T>): T {
  return mocked;
}
useStore(sameValue(store));

// Its methods are mocks at every depth, and its other members keep their types.
jest.mocked(store).get.mockReturnValue("x");
jest.mocked(store).connection.query.mockReturnValue([]);
jest.mocked(client).nested.close.mockReturnValue(false);
expectType(jest.mocked(client).retries).is<number>();

// A call through a mocked function uses the function's own signatures.
expectType(jest.mocked(pick)(1 as const)).is<1>();
expectType(jest.mocked(parse)("a")).is<string>();
expectType(jest.mocked(parse)(1)).is<number>();
expectType(jest.mocked(api).pick(1 as const)).is<1>();
expectType(jest.mocked(api).nested.pick(1 as const)).is<1>();
expectType(vi.mockObject(api).pick(1 as const)).is<1>();
expectType(jest.createMockFromModule<typeof api>("./api").pick(1 as const)).is<1>();
expectType(jest.mocked(fs).readFileSync("path", "utf8")).is<string>();
if (jest.mocked(isText)(unknownValue)) expectType(unknownValue).is<string>();
if (jest.mocked(api).isText(unknownValue)) expectType(unknownValue).is<string>();
jest.mocked(pick).mockClear();
jest.mocked(parse).mockClear();
jest.mocked(query).where("a").where("b").all.mockReturnValue([]);
expectType(jest.mocked(query).where("a")).is<Mocked<Query>>();
// @ts-expect-error The signature still says `asserts`, and TypeScript takes an assertion only from a declared name.
jest.mocked(invariant)(unknownValue);

// A function that has members.
const mockedHttp = jest.mocked(http);
const sameHttp: Http = mockedHttp;
mockedHttp.mockResolvedValue({ data: 1 });
mockedHttp.get.mockResolvedValue({ data: 1 });
mockedHttp.create.mockReturnValue(mockedHttp);
mockedHttp.interceptors.request.use.mockReturnValue(1);
expectType(mockedHttp.get<string>("/")).is<Promise<{ data: string }>>();
jest.mocked(fetch).preconnect.mockReturnValue();

// A mocked class is still the class. `new` has the constructor's own signatures, and the methods of what it gives
// are mocks.
const MockedStore = jest.mocked(Store);
const sameClass: typeof Store = MockedStore;
MockedStore.mockClear();
MockedStore.open.mockReturnValue(store);
MockedStore.prototype.get.mockReturnValue("x");
const mockedInstance = new MockedStore(connection);
useStore(mockedInstance);
mockedInstance.get.mockReturnValue("x");
useStore(MockedStore.mock.instances[0]!);
MockedStore.mock.instances[0]!.get.mockReturnValue("x");
new (jest.mocked(Address))("url").host.mockReturnValue("x");
new (jest.mocked(Address))("host", 1).host.mockReturnValue("x");
new (jest.mocked(Level))("debug").label.mockReturnValue("x");
new (jest.mocked(Query))().where("a").all.mockReturnValue([]);
new (jest.mocked(api).Store)(connection).get.mockReturnValue("x");
new (vi.mockObject(api).Store)(connection).get.mockReturnValue("x");
const sameBox: Box<number> = new (jest.mocked(Box))(1);
expectType(jest.mocked(Box).of(1)).is<Box<number>>();
expectType(jest.mocked(Box).prototype.unwrap.mock.results[0]!.value).is<unknown>();
expectType<InstanceType<typeof MockedStore>>().extends<Store>();
class SubStore extends jest.mocked(Store) {}
useStore(new SubStore(connection));
// A hand-made object can stand in for the instance.
MockedStore.mockImplementation(() => ({ get: jest.fn(), connection: { query: jest.fn() } }));
// @ts-expect-error
new MockedStore("not a connection");
// @ts-expect-error A class isn't callable without `new`.
MockedStore(connection);

// The elements of a mocked array are mocked too.
jest.mocked(stores).forEach(each => each.get.mockReturnValue("x"));
jest.mocked(stores).map(each => useStore(each));
jest.mocked(frozenStores).find(each => each.get.mock.calls.length > 0);
jest.mocked(stores)[0]!.get.mockReturnValue("x");
jest.mocked(pair)[0].get.mockReturnValue("x");
expectType(jest.mocked(pair)[1]).is<number>();
const sameStores: Store[] = jest.mocked(stores);
const mockedStores: Mocked<Store>[] = jest.mocked(stores);
jest.mocked(holder).stores[0]!.get.mockReturnValue("x");
// @ts-expect-error A callback of an array inside a mocked object receives the elements as `T` types them.
jest.mocked(holder).stores.forEach(each => each.get.mockReturnValue("x"));

// A member that is a union of object types keeps its type. A recursive type ends.
const sameHolder: typeof holder = jest.mocked(holder);
jest.mocked(holder).load.mockReturnValue("x");
jest.mocked(holder).maybe?.get.mockReturnValue("x");
expectType(jest.mocked(holder).either).is<Store | Query>();
const either = jest.mocked(holder.either);
if (either instanceof Store) either.get.mockReturnValue("x");

// Annotations, casts and writes.
const annotated: Mocked<Store> = jest.mocked(store);
const mockedTwice: Mocked<Store> = vi.mocked(jest.mocked(store));
expectType(vi.mocked(jest.mocked(pick))).is<Mocked<typeof pick>>();
(store as Mocked<Store>).get.mockReturnValue("x");
(Store as Mocked<typeof Store>).open.mockReturnValue(store);
const handMade: Mocked<Pick<Store, "get">> = { get: jest.fn() };
// @ts-expect-error An object literal has no `rows`, so it isn't a `Store`.
const notAStore: Mocked<Store> = { get: jest.fn(), connection: jest.mocked(connection) };
jest.mocked(client).get = jest.fn();
// @ts-expect-error A member keeps its own type, which a mock of any function doesn't have if it's generic.
jest.mocked(api).pick = jest.fn();
expectType<ReturnType<typeof jest.mocked<Store>>>().is<Mocked<Store>>();
expectType<ReturnType<typeof vi.mocked<Store>>>().is<Mocked<Store>>();
expectType(jest.mocked(1)).is<number>();
expectType(jest.createMockFromModule("./store")).is<any>();

// Types as large as lib.dom's. Without lib.dom these are a `Date`.
type DomGlobal<Name extends string> = typeof globalThis extends Record<Name, infer Value> ? Value : Date;
declare const page: DomGlobal<"document">;
declare const view: DomGlobal<"window">;
const samePage: typeof page = jest.mocked(page);
const sameView: typeof view = vi.mocked(view);
