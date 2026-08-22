import { jest, mock, type Mock, spyOn, vi } from "bun:test";
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

// A mock of a generic function keeps the generic call signature.
// https://github.com/oven-sh/bun/issues/38037
{
  type Run = <T>(callback: () => PromiseLike<T>) => Promise<T>;
  const run: Run = async callback => callback();

  const mocked = mock(run);
  const mockedAsRun: Run = mocked;
  expectType(mocked(async () => 42)).is<Promise<number>>();
  expectType(mocked.mock.calls).is<[callback: () => PromiseLike<unknown>][]>();
  mocked.mockClear();

  const jestMocked = jest.fn(run);
  const jestMockedAsRun: Run = jestMocked;
  expectType(jestMocked(async () => "a")).is<Promise<string>>();

  const viMocked = vi.fn(run);
  const viMockedAsRun: Run = viMocked;
  expectType(viMocked(async () => true)).is<Promise<boolean>>();

  const target = { run };
  const spied = spyOn(target, "run");
  const spiedAsRun: Run = spied;
  expectType(spied(async () => 1n)).is<Promise<bigint>>();
  spied.mockRestore();

  void [mockedAsRun, jestMockedAsRun, viMockedAsRun, spiedAsRun];
}

// A mock of an overloaded function keeps every overload.
{
  function parse(input: string): number;
  function parse(input: number): string;
  function parse(input: string | number) {
    return typeof input === "string" ? Number(input) : String(input);
  }

  const mocked = mock(parse);
  expectType(mocked("1")).is<number>();
  expectType(mocked(1)).is<string>();
  // @ts-expect-error no overload accepts a boolean
  mocked(true);
}

// Mocks without an implementation, and with an explicit implementation type.
{
  const untyped = mock();
  untyped(1, "two", { three: 3 });

  const typed = mock<(input: number) => string>();
  expectType(typed(1)).is<string>();
  // @ts-expect-error the implementation type is (input: number) => string
  typed("1");

  const declared: Mock<(input: string) => number> = mock((input: string) => input.length);
  expectType(declared("abc")).is<number>();
  expectType(declared.mock.calls).is<[input: string][]>();
  declared.mockReturnValue(1);
  // @ts-expect-error the return type is number
  declared.mockReturnValue("1");

  expectType(vi.fn<(input: number) => string>()(1)).is<string>();
}
