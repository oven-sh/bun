import { expect, test } from "bun:test";
import path from "node:path";

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

test.each(["posix", "win32"] as const)("the functions of path.%s are named as in Node.js", flavor => {
  expect(names.map(name => path[flavor][name].name)).toEqual([...names]);
});
