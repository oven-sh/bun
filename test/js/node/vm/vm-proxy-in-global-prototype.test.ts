// https://github.com/oven-sh/bun/issues/42331
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { constants, createContext, runInContext, Script } from "node:vm";

describe.each([
  ["DONT_CONTEXTIFY", () => createContext(constants.DONT_CONTEXTIFY)],
  ["a contextified object", () => createContext({})],
])("programs that start with a Proxy in the prototype chain of the global: %s", (_, makeContext) => {
  function makeContextWithProxy() {
    const ctx = makeContext();
    const inner = runInContext("this", ctx);
    const target = { fromProxy: 7 };
    const traps: string[] = [];
    const handler: Record<string, Function> = {};
    for (const trap of Object.getOwnPropertyNames(Reflect) as (keyof typeof Reflect)[]) {
      handler[trap] = (...args: any[]) => {
        if (typeof args[1] !== "symbol") traps.push(typeof args[1] === "string" ? `${trap} ${args[1]}` : trap);
        return (Reflect[trap] as Function)(...args);
      };
    }
    Object.setPrototypeOf(inner, Object.create(new Proxy(target, handler)));
    traps.length = 0;
    return { ctx, inner, target, traps };
  }

  test("they run", () => {
    const { ctx } = makeContextWithProxy();
    expect(runInContext("1 + 1", ctx)).toBe(2);
    expect(new Script("2 + 2").runInContext(ctx)).toBe(4);
  });

  test("declaring runs no trap", () => {
    const { ctx, target, traps } = makeContextWithProxy();
    runInContext(
      `var declaredVar = 1;
      function declaredFunction() { return 2; }
      let declaredLet = 3;
      const declaredConst = 4;
      class DeclaredClass {}`,
      ctx,
    );
    expect(traps).toEqual([]);
    expect(
      runInContext("[declaredVar, declaredFunction(), declaredLet, declaredConst, typeof DeclaredClass].join()", ctx),
    ).toBe("1,2,3,4,function");
    expect(traps).toEqual([]);
    expect(target).toEqual({ fromProxy: 7 });
  });

  test("a declaration shadows what the Proxy has", () => {
    const { ctx, inner, target } = makeContextWithProxy();
    expect(runInContext("function fromProxy() {} typeof fromProxy", ctx)).toBe("function");
    expect(Object.hasOwn(inner, "fromProxy")).toBe(true);
    expect(target).toEqual({ fromProxy: 7 });
  });

  test("a redeclaration is still an error", () => {
    const { ctx } = makeContextWithProxy();
    runInContext("let declaredLet = 1", ctx);
    expect(() => runInContext("let declaredLet = 2", ctx)).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    expect(() => runInContext("var declaredLet; 0", ctx)).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    expect(runInContext("declaredLet", ctx)).toBe(1);
  });

  test("names resolve through the Proxy", () => {
    const { ctx } = makeContextWithProxy();
    expect(runInContext("fromProxy", ctx)).toBe(7);
    expect(runInContext("typeof missingName", ctx)).toBe("undefined");
    expect(runInContext("'fromProxy' in globalThis", ctx)).toBe(true);
    expect(runInContext("'missingName' in globalThis", ctx)).toBe(false);
  });

  test("a store makes an own property of the global", () => {
    const { ctx, inner, target } = makeContextWithProxy();
    expect(runInContext("createdByStore = 9; createdByStore", ctx)).toBe(9);
    expect(runInContext("fromProxy = 8; fromProxy", ctx)).toBe(8);
    expect(runInContext("[createdByStore, fromProxy].join()", ctx)).toBe("9,8");
    expect([Object.hasOwn(inner, "createdByStore"), Object.hasOwn(inner, "fromProxy")]).toEqual([true, true]);
    expect(target).toEqual({ fromProxy: 7 });
  });
});

test("a global shaped like the window of jsdom", () => {
  const window = createContext(constants.DONT_CONTEXTIFY);
  const namedElements = new Map<PropertyKey, object>([["byId", { id: "byId" }]]);
  const eventTargetPrototype = Object.create(window.Object.prototype, {
    addEventListener: { value() {}, writable: true, configurable: true },
  });
  const windowProperties = new Proxy(Object.create(eventTargetPrototype), {
    has: (target, key) => namedElements.has(key) || Reflect.has(target, key),
    get: (target, key, receiver) => namedElements.get(key) ?? Reflect.get(target, key, receiver),
    set: (_, key, value, receiver) =>
      Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }),
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  Object.setPrototypeOf(window, Object.create(windowProperties));
  window.window = window;

  runInContext(
    `var a = 1;
    function f() { return a + 1; }
    window.b = f();
    c = typeof addEventListener;
    d = byId.id;
    byId = "shadowed";`,
    window,
  );
  expect(runInContext("[a, f(), b, c, d, byId].join()", window)).toBe("1,2,2,function,byId,shadowed");
  expect({ a: window.a, f: typeof window.f, b: window.b, c: window.c, d: window.d, byId: window.byId }).toEqual({
    a: 1,
    f: "function",
    b: 2,
    c: "function",
    d: "byId",
    byId: "shadowed",
  });
});

test.concurrent("the main realm: runInThisContext() and require()", async () => {
  using dir = tempDir("vm-proxy-in-global-prototype", { "dependency.cjs": "module.exports = viaProxy + 1;" });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const vm = require("node:vm");
      Object.setPrototypeOf(globalThis, Object.create(new Proxy({ viaProxy: 3 }, {})));
      console.log(
        vm.runInThisContext("1 + 1"),
        vm.runInThisContext("viaProxy"),
        vm.runInThisContext("var declaredVar = 5; declaredVar"),
        globalThis.declaredVar,
        require("./dependency.cjs"),
      );`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2 3 5 5 4\n", stderr: "", exitCode: 0 });
});
