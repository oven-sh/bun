import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as CJSArrayLike from "./cjs-defineProperty-arraylike.cjs";
import * as CJS from "./cjs-defineProperty-fixture.cjs";
import * as Self from "./esm-defineProperty.test.ts";
import * as FnNS from "./cjs-function-exports-fixture.cjs";
import * as ClassNS from "./cjs-class-exports-fixture.cjs";
import * as ArrowNS from "./cjs-arrow-exports-fixture.cjs";
// https://github.com/oven-sh/bun/issues/4432
test("defineProperty", () => {
  expect(CJS.a).toBe(1);
  expect(CJS.b).toBe(2);
  // non-enumerable getter/setter are not copied, matching node.js
  expect(CJS.c).toBe(undefined);

  expect(Bun.inspect(CJS.default)).toBe(`{\n  a: 1,\n  b: 2,\n  c: [Getter],\n}`);
});
export const __esModule = true;
test("shows __esModule if it was exported", () => {
  expect(Bun.inspect(Self)).toBe(`Module {
  __esModule: true,
}`);
  expect(Object.getOwnPropertyNames(Self)).toContain("__esModule");
});

test("arraylike", () => {
  expect(CJSArrayLike[0]).toBe(0);
  expect(CJSArrayLike[1]).toBe(1);
  expect(CJSArrayLike[2]).toBe(3);
  expect(CJSArrayLike[3]).toBe(4);
  expect(CJSArrayLike[4]).toBe(undefined);
  expect(CJSArrayLike).toHaveProperty("4");
  expect(Object.getOwnPropertyNames(CJSArrayLike)).not.toContain("__esModule");
  expect(Object.getOwnPropertyNames(CJSArrayLike.default)).not.toContain("__esModule");
  expect(Bun.inspect(CJSArrayLike)).toBe(`Module {
  "0": 0,
  "1": 1,
  "2": 3,
  "3": 4,
  "4": undefined,
  default: {
    "0": 0,
    "1": 1,
    "2": [Getter],
    "3": 4,
    "4": [Getter],
  },
}`);
});

// When module.exports is a function (or class, or arrow), the function's own
// non-enumerable intrinsics length/name/prototype must not become ES named exports.
describe("module.exports = function: intrinsics are not named exports", () => {
  test("function namespace", () => {
    expect(Object.getOwnPropertyNames(FnNS).sort()).toEqual(["default", "x"]);
    expect(FnNS.x).toBe(7);
    expect(typeof FnNS.default).toBe("function");
    expect(FnNS.default(1, 2)).toBe(3);
  });

  test("class namespace", () => {
    expect(Object.getOwnPropertyNames(ClassNS).sort()).toEqual(["default", "y"]);
    expect(ClassNS.y).toBe(42);
    expect(typeof ClassNS.default).toBe("function");
  });

  test("arrow namespace", () => {
    expect(Object.getOwnPropertyNames(ArrowNS).sort()).toEqual(["default", "z"]);
    expect(ArrowNS.z).toBe("hello");
    expect(ArrowNS.default(1, 2, 3)).toBe(6);
  });

  test.each(["name", "length", "prototype"])("import { %s } is a link error", async intrinsic => {
    using dir = tempDir("cjs-fn-intrinsic", {
      "b.cjs": `module.exports = function realFn(a, b) { return 7; };\nmodule.exports.x = 7;\n`,
      "entry.mjs": `import { ${intrinsic} } from "./b.cjs"; console.log(${intrinsic});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(stderr).toContain("SyntaxError");
    expect(stderr).toContain(`'${intrinsic}'`);
  });
});
