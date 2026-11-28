import { expect, test } from "bun:test";
import path from "node:path";
import { inspect } from "node:util";

test.each(["posix", "win32"] as const)("path.%s has the properties of Node.js, in the same order", flavor => {
  const describe = (value: any) => (typeof value === "function" ? `${value.name}/${value.length}` : typeof value);
  expect(Object.entries(path[flavor]).map(([key, value]) => [key, describe(value)])).toEqual([
    ["resolve", "resolve/0"],
    ["normalize", "normalize/1"],
    ["isAbsolute", "isAbsolute/1"],
    ["join", "join/0"],
    ["relative", "relative/2"],
    ["toNamespacedPath", "toNamespacedPath/1"],
    ["dirname", "dirname/1"],
    ["basename", "basename/2"],
    ["extname", "extname/1"],
    ["format", "bound _format/1"],
    ["parse", "parse/1"],
    ["matchesGlob", "matchesGlob/2"],
    ["sep", "string"],
    ["delimiter", "string"],
    ["win32", "object"],
    ["posix", "object"],
    ["_makeLong", "toNamespacedPath/1"],
  ]);
});

test.each(["posix", "win32"] as const)("the functions of path.%s print their names", flavor => {
  const { format, toNamespacedPath, _makeLong, sep, delimiter, win32, posix, ...natives } = path[flavor] as any;
  for (const [name, native] of Object.entries<Function>(natives)) {
    expect([inspect(native), Bun.inspect(native), String(native).replace(/\s+/g, " ")]).toEqual([
      `[Function: ${name}]`,
      `[Function: ${name}]`,
      `function ${name}() { [native code] }`,
    ]);
  }
  expect([inspect(format), Bun.inspect(format)]).toEqual(["[Function: bound _format]", "[Function: _format]"]);
  expect([inspect(toNamespacedPath), Bun.inspect(toNamespacedPath)]).toEqual(
    Array(2).fill("[Function: toNamespacedPath]"),
  );
});

test.each(["posix", "win32"] as const)("of the functions of path.%s only format is a constructor", flavor => {
  const { format, ...methods } = path[flavor] as any;
  for (const method of Object.values<any>(methods)) {
    if (typeof method !== "function") continue;
    expect(Object.hasOwn(method, "prototype")).toBe(false);
    expect(() => new method("a", "b")).toThrow(TypeError);
  }
  expect(typeof new format({ base: "a" })).toBe("object");
});
