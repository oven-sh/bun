import { internalModuleBytecode } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { encodeLazyFunctionTable, findLazyFunctions } from "../../src/codegen/lazy-function-table";

const wrap = (body: string) => `(function (){"use strict";${body}})\n`;
const lazyFunctionsOf = (body: string) => {
  const source = wrap(body);
  const table = findLazyFunctions(source);
  return {
    functions: (table?.functions ?? []).map(fn => source.slice(fn.parametersStart, fn.closeBrace + 1)),
    parameterCounts: (table?.functions ?? []).map(fn => fn.parameterCount),
    capturedNames: (table?.capturedNames ?? []).map(({ start, length }) => source.slice(start, start + length)),
  };
};

test.skipIf(isDebug)("the lazy function table of every internal module agrees with the parser", () => {
  let lazyFunctionCount = 0;
  for (let index = 0; ; index++) {
    const module = internalModuleBytecode(index);
    if (module === null) break;
    lazyFunctionCount += module.lazyFunctionCount;
  }
  expect(lazyFunctionCount).toBeGreaterThan(1000);
});

test("top-level functions are lazy, nested and non-plain ones are not", () => {
  const { functions } = lazyFunctionsOf(`
var a = 1;
function declared(x, y) { return a + x + y + 1000000; }
Foo.prototype.method = function method() { return function inner() { return a + 2000000; }; };
async function asynchronous() { return a + 3000000000; }
function* generator() { yield a + 4000000000; }
var arrow = () => function inArrowExpression() { return a + 5000000; };
var block = () => { return function inArrowBlock() { return a + 6000000; }; };
var object = { method() { return function inMethod() { return a + 7000000; }; }, value: function inObject() { return a + 8; } };
class C { method() { return function inClass() { return a + 9000000; }; } }
if (a) { Foo.conditional = function inBlock() { return a + 10000000; }; }
for (let i = 0, f = function inLoopHead() { return i + 11000000; }; i < 1; i++);
call(function argument() { return a + 12000000; });
return a`);
  expect(functions).toEqual([
    "(x, y) { return a + x + y + 1000000; }",
    "() { return function inner() { return a + 2000000; }; }",
    "() { return a + 12000000; }",
  ]);
});

test("parameters count up to the first default or rest parameter", () => {
  const { parameterCounts } = lazyFunctionsOf(`
function none() { return 1000000000000; }
function two(a, b) { return 1000000000000; }
function patterns({ a, b = 1 }, [c, d]) { return 1000000000000; }
function defaulted(a, b = (1, 2), c) { return 1000000000000; }
function rest(a, ...b) { return 1000000000000; }
return 1`);
  expect(parameterCounts).toEqual([0, 2, 2, 1, 1]);
});

test("regular expressions, templates, strings and comments do not unbalance a function", () => {
  const { functions } = lazyFunctionsOf(`
function tricky(a) { return [/[/}]{/.test(a), a / 2 / 3, \`}\${a ? \`{\${a}\` : "}"}{\`, "}", '{', /* } */ a]; // }
}
function next() { return 1000000000000; }
return 1`);
  expect(functions.length).toBe(2);
  expect(functions[1]).toBe("() { return 1000000000000; }");
});

test("variables a lazy function may capture are listed", () => {
  const { capturedNames } = lazyFunctionsOf(`
var used = 1, unused = 2, { destructured } = used;
class Class {}
function reader() { return used + destructured + new Class().unused + other() + global; }
function other() { return 1000000000000; }
return unused`);
  expect(capturedNames.sort()).toEqual(["Class", "destructured", "other", "used"]);
});

test("an encoded table is empty for a module without lazy functions", () => {
  expect(encodeLazyFunctionTable(findLazyFunctions(wrap("return 1")))).toEqual([]);
});

test("internal modules load the same with and without the source provider cache", async () => {
  const script = `
    const names = require("node:module").builtinModules.filter(name => !name.startsWith("bun:") && name !== "wasi" && name !== "test");
    console.log(names.map(name => name + ":" + Object.keys(require(name)).length).join(" "));
    const { Readable } = require("node:stream");
    console.log(Readable.from.toString(), Readable.prototype.read.name, Readable.prototype.read.length);
    try {
      Readable.from(5);
    } catch (error) {
      console.log(error.stack);
    }
  `;
  const run = async (env: Record<string, string>) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-deprecation", "-e", script],
      env: { ...bunEnv, ...env },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const [withCache, withoutCache] = await Promise.all([run({}), run({ BUN_JSC_useSourceProviderCache: "0" })]);
  expect(withCache).toEqual(withoutCache);
  expect(withCache.exitCode).toBe(0);
});
