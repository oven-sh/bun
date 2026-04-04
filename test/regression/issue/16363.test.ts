import { expect, test } from "bun:test";
import VM from "vm";

// https://github.com/oven-sh/bun/issues/16363
// When a sandbox has `globalThis = sandbox` (as happy-dom does), builtins like
// eval, parseInt, Array, etc. should still be accessible via `globalThis.eval`
// inside the VM context.

test("globalThis.eval is available when sandbox has globalThis = sandbox", () => {
  const sandbox = {} as Record<string, unknown>;
  sandbox.globalThis = sandbox;
  VM.createContext(sandbox);

  const result = new VM.Script("typeof globalThis.eval").runInContext(sandbox);
  expect(result).toBe("function");
});

test("globalThis builtins are not shadowed by sandbox's globalThis property", () => {
  const sandbox = {} as Record<string, unknown>;
  sandbox.globalThis = sandbox;
  VM.createContext(sandbox);

  const result = JSON.parse(
    new VM.Script(`
    JSON.stringify({
      typeofEval: typeof globalThis.eval,
      typeofParseInt: typeof globalThis.parseInt,
      typeofArray: typeof globalThis.Array,
      typeofObject: typeof globalThis.Object,
      typeofMath: typeof globalThis.Math,
      typeofJSON: typeof globalThis.JSON,
    })
  `).runInContext(sandbox),
  );

  expect(result.typeofEval).toBe("function");
  expect(result.typeofParseInt).toBe("function");
  expect(result.typeofArray).toBe("function");
  expect(result.typeofObject).toBe("function");
  expect(result.typeofMath).toBe("object");
  expect(result.typeofJSON).toBe("object");
});

test("globalThis works normally without sandbox.globalThis property", () => {
  const sandbox = {} as Record<string, unknown>;
  VM.createContext(sandbox);

  const result = new VM.Script("typeof globalThis.eval").runInContext(sandbox);
  expect(result).toBe("function");
});
