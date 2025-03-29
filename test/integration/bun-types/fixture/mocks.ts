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
