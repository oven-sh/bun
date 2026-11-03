import python, { float, kwargs, type KeywordArguments } from "bun:python";
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

// @ts-expect-error
kwargs();
// @ts-expect-error
float("2");

expectType(await import("python:re")).is<any>();
expectType(require("python:re")).is<any>();
