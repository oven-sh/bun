import { jest, mock } from "bun:test";
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

// withImplementation() returns a promise when its callback returns a promise or any other object with a then() method.
declare const promiseLike: PromiseLike<void>;
const minimalThenable = {
  then(resolve: () => void) {
    resolve();
  },
};
const temporarilyMocked = jest.fn<() => string>();
const temporary = () => "temporary";
expectType(temporarilyMocked.withImplementation(temporary, async () => {})).is<Promise<void>>();
expectType(temporarilyMocked.withImplementation(temporary, () => promiseLike)).is<Promise<void>>();
expectType(temporarilyMocked.withImplementation(temporary, () => minimalThenable)).is<Promise<void>>();
expectType(temporarilyMocked.withImplementation(temporary, () => {})).is<void>();
expectType(temporarilyMocked.withImplementation(temporary, () => ({ then: 42 }))).is<void>();
