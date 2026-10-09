import { describe, expect, jest, mock, type Mock, spyOn, test, vi } from "bun:test";
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

// a spy that is declared before it is created
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

// a mock that is declared before it is created
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
expectType<Parameters<typeof test.each>>().is<[table: unknown[]]>();
expectType<Parameters<typeof describe.each>>().is<[table: unknown[]]>();

// a table that is `any` is not taken for a tagged template
test.each({} as any)("%s", (a, b, c) => {});
describe.each({} as any)("%s", (a, b) => {});

// parameters without a type are `any`, not an implicit `any`
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
