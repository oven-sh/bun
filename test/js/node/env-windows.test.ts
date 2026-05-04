import { createWindowsEnvProxyForTesting } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.if(isWindows)("process.env is case insensitive on windows", () => {
  const keys = Object.keys(process.env);
  // this should have at least one character that is lowercase
  // it is likely that PATH will be 'Path', and also stuff like 'WindowsLibPath' and so on.
  // but not guaranteed, so we just check that there is at least one of each case
  expect(
    keys
      .join("")
      .split("")
      .some(c => c.toUpperCase() !== c),
  ).toBe(true);
  expect(
    keys
      .join("")
      .split("")
      .some(c => c.toLowerCase() !== c),
  ).toBe(true);
  expect(process.env.path).toBe(process.env.PATH!);
  expect(process.env.pAtH).toBe(process.env.PATH!);

  expect(process.env.doesntexistahahahahaha).toBeUndefined();
  // @ts-expect-error
  process.env.doesntExistAHaHaHaHaHa = true;
  expect(process.env.doesntexistahahahahaha).toBe("true");
  expect(process.env.doesntexistahahahahaha).toBe("true");
  expect(process.env.doesnteXISTahahahahaha).toBe("true");
  expect(Object.keys(process.env).pop()).toBe("doesntExistAHaHaHaHaHa");
  delete process.env.DOESNTEXISTAHAHAHAHAHA;
  expect(process.env.doesntexistahahahahaha).toBeUndefined();
  expect(Object.keys(process.env)).not.toInclude("doesntExistAHaHaHaHaHa");
});

// https://github.com/oven-sh/bun/issues/30226
// https://github.com/oven-sh/bun/issues/26315
// https://github.com/oven-sh/bun/issues/9779
//
// On Windows, process.env is a Proxy whose `get` trap used to only consult
// the env map and never fall through to Object.prototype. That made
// `process.env.hasOwnProperty` (and toString, valueOf, etc.) return undefined,
// breaking packages like dotenv-expand that call these inherited methods.
test.if(isWindows)("process.env inherits Object.prototype methods on windows (#30226)", () => {
  expect(typeof process.env.hasOwnProperty).toBe("function");
  expect(typeof process.env.toString).toBe("function");
  expect(typeof process.env.valueOf).toBe("function");
  expect(typeof process.env.propertyIsEnumerable).toBe("function");
  expect(typeof process.env.isPrototypeOf).toBe("function");

  expect(process.env.hasOwnProperty("PATH")).toBe(true);
  expect(process.env.hasOwnProperty("__NOT_A_REAL_ENV_VAR_30226__")).toBe(false);
  expect(process.env.toString()).toBe("[object Object]");

  // A case-insensitive env var should still be reported by hasOwnProperty.
  process.env.HAS_OWN_TEST_30226 = "1";
  try {
    expect(process.env.hasOwnProperty("HAS_OWN_TEST_30226")).toBe(true);
    expect(process.env.hasOwnProperty("has_own_test_30226")).toBe(true);
  } finally {
    delete process.env.HAS_OWN_TEST_30226;
  }

  // If a user actually sets an env var whose name collides with an
  // Object.prototype method, the env var wins (Node.js parity).
  const original = process.env.HASOWNPROPERTY;
  try {
    process.env.HASOWNPROPERTY = "shadow_value";
    expect(process.env.HASOWNPROPERTY).toBe("shadow_value");
    expect(process.env.hasOwnProperty).toBe("shadow_value");
  } finally {
    if (original === undefined) {
      delete process.env.HASOWNPROPERTY;
    } else {
      process.env.HASOWNPROPERTY = original;
    }
    // Once the env var is gone, the inherited method comes back.
    expect(typeof process.env.hasOwnProperty).toBe("function");
  }
});

// This exercises the exact JS builtin that wraps `process.env` on Windows.
// It runs on every platform so the regression gate on POSIX still catches a
// broken `windowsEnv` Proxy — the Windows-only test above is skipped on CI
// lanes that don't run on Windows.
test("windowsEnv Proxy falls back to Object.prototype for hasOwnProperty (#30226)", () => {
  const internalEnv: Record<string, string> = { PATH: "/usr/bin", BACON: "yummy" };
  const envMapList = ["PATH", "BACON"];
  const edits: Array<[string, string | null]> = [];
  const env = createWindowsEnvProxyForTesting(internalEnv, envMapList, (k, v) => {
    edits.push([k, v]);
  });

  // Inherited Object.prototype methods resolve through the Proxy.
  expect(typeof env.hasOwnProperty).toBe("function");
  expect(typeof env.toString).toBe("function");
  expect(typeof env.valueOf).toBe("function");
  expect(typeof env.propertyIsEnumerable).toBe("function");
  expect(typeof env.isPrototypeOf).toBe("function");

  expect(env.hasOwnProperty("PATH")).toBe(true);
  expect(env.hasOwnProperty("bacon")).toBe(true); // case-insensitive
  expect(env.hasOwnProperty("__definitely_not_set__")).toBe(false);
  expect(env.toString()).toBe("[object Object]");

  // Case-insensitive env lookup still wins over the prototype chain.
  expect(env.PATH).toBe("/usr/bin");
  expect(env.path).toBe("/usr/bin");
  expect(env.PaTh).toBe("/usr/bin");

  // Set/delete still round-trip through the edit callback.
  env.NEW_VAR = "hello";
  expect(env.new_var).toBe("hello");
  expect(edits).toContainEqual(["NEW_VAR", "hello"]);

  delete env.new_var;
  expect(env.NEW_VAR).toBeUndefined();
  expect(edits).toContainEqual(["NEW_VAR", null]);

  // An env var whose name collides with an Object.prototype method shadows
  // the inherited method (Node.js parity).
  env.HASOWNPROPERTY = "shadow";
  expect(env.HASOWNPROPERTY).toBe("shadow");
  expect(env.hasOwnProperty).toBe("shadow");
  delete env.HASOWNPROPERTY;
  expect(typeof env.hasOwnProperty).toBe("function");
});
