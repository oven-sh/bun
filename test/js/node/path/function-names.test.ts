import { expect, test } from "bun:test";
import path from "node:path";
import { inspect } from "node:util";

const names = [
  "resolve",
  "normalize",
  "isAbsolute",
  "join",
  "relative",
  "toNamespacedPath",
  "dirname",
  "basename",
  "extname",
  "format",
  "parse",
] as const;

test.each(["posix", "win32"] as const)("the functions of path.%s are named as bound functions are", flavor => {
  expect(names.map(name => path[flavor][name].name)).toEqual(names.map(name => `bound ${name}`));
  expect(names.map(name => inspect(path[flavor][name]))).toEqual(names.map(name => `[Function: bound ${name}]`));
  expect(names.map(name => Bun.inspect(path[flavor][name]))).toEqual(names.map(name => `[Function: ${name}]`));
  expect(names.map(name => String(path[flavor][name]).replace(/\s+/g, " "))).toEqual(
    names.map(name => `function ${name}() { [native code] }`),
  );
});
