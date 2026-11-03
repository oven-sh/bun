import python, { asyncWith, float, kwargs, method, with as with_, type KeywordArguments } from "bun:python";
import json, { dumps, loads } from "python:json";
import * as os from "python:os";
import path from "python:os.path";
import mine, { something } from "./mine.py";
import { expectType } from "./utilities";

expectType(json).is<any>();
expectType(dumps).is<any>();
expectType(loads("[1]")).is<any>();
expectType(os.getcwd()).is<any>();
expectType(path.join("a", "b")).is<any>();
expectType(mine).is<any>();
expectType(something).is<any>();

expectType(kwargs({ indent: 2 })).is<KeywordArguments>();
expectType(float(2)).is<unknown>();
expectType(python.import("os.path")).is<any>();
expectType(python.kwargs).is<typeof kwargs>();

dumps([1, 2], kwargs({ indent: 2 }));

expectType(with_(mine.manager(), (value: string) => value.length)).is<number | undefined>();
expectType(python.with(mine.a, mine.b, (a, b) => [a, b])).is<any[] | undefined>();
expectType(asyncWith(mine.manager(), async () => "text")).is<Promise<string | undefined>>();
expectType(asyncWith(mine.manager(), () => 1)).is<Promise<number | undefined>>();
expectType(
  method(function () {
    return this.anything;
  }),
).is<any>();

class Derived extends mine.Base {
  method() {
    return super.method();
  }
}
expectType(new Derived()).is<Derived>();

// @ts-expect-error
with_(1);
// @ts-expect-error
method(1);

// @ts-expect-error
kwargs();
// @ts-expect-error
float("2");

expectType(await import("python:re")).is<any>();
expectType(require("python:re")).is<any>();
