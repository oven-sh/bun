// From-scratch implementation of the subset of V8's mjsunit assertion API used
// by the vendored regexp tests in ./mjsunit. Not derived from V8's mjsunit.js.
// Runs identically under bun and node so the same test corpus can be executed
// in both engines (node acting as the oracle).

class MjsUnitAssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "MjsUnitAssertionError";
  }
}

function fmt(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return "[" + value.map(fmt).join(",") + "]";
  if (typeof value === "object") {
    try {
      const keys = Object.keys(value);
      return "{" + keys.map(k => `${k}:${fmt(value[k])}`).join(",") + "}";
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// V8's assertEquals is a deep-equality check that treats holey/undefined array
// elements and object property sets structurally.
function deepEquals(a, b) {
  if (a === b) return a !== 0 || 1 / a === 1 / b; // -0 vs +0
  if (typeof a !== typeof b) return false;
  if (typeof a === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  const classA = Object.prototype.toString.call(a);
  const classB = Object.prototype.toString.call(b);
  if (classA !== classB) return false;
  if (classA === "[object RegExp]") return String(a) === String(b);
  if (classA === "[object Array]") {
    // Arrays compare by elements only, so a RegExp match array (which carries
    // index/input/groups) equals a plain array literal of the same elements.
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEquals(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEquals(a[k], b[k])) return false;
  }
  return true;
}

export function assertEquals(expected, found, name_opt) {
  if (!deepEquals(expected, found)) {
    throw new MjsUnitAssertionError(
      `assertEquals failed: expected ${fmt(expected)} found ${fmt(found)}` + (name_opt ? ` - ${name_opt}` : ""),
    );
  }
}

export function assertNotEquals(expected, found, name_opt) {
  if (deepEquals(expected, found)) {
    throw new MjsUnitAssertionError(`assertNotEquals failed: both ${fmt(found)}` + (name_opt ? ` - ${name_opt}` : ""));
  }
}

export function assertSame(expected, found, name_opt) {
  if (!Object.is(expected, found)) {
    throw new MjsUnitAssertionError(
      `assertSame failed: expected ${fmt(expected)} found ${fmt(found)}` + (name_opt ? ` - ${name_opt}` : ""),
    );
  }
}

export function assertTrue(value, name_opt) {
  assertEquals(true, value, name_opt);
}

export function assertFalse(value, name_opt) {
  assertEquals(false, value, name_opt);
}

export function assertNull(value, name_opt) {
  if (value !== null)
    throw new MjsUnitAssertionError(`assertNull failed: ${fmt(value)}` + (name_opt ? ` - ${name_opt}` : ""));
}

export function assertNotNull(value, name_opt) {
  if (value === null) throw new MjsUnitAssertionError(`assertNotNull failed` + (name_opt ? ` - ${name_opt}` : ""));
}

export function assertArrayEquals(expected, found, name_opt) {
  const ok =
    Array.isArray(expected) &&
    Array.isArray(found) &&
    expected.length === found.length &&
    expected.every((v, i) => deepEquals(v, found[i]));
  if (!ok) {
    throw new MjsUnitAssertionError(
      `assertArrayEquals failed: expected ${fmt(expected)} found ${fmt(found)}` + (name_opt ? ` - ${name_opt}` : ""),
    );
  }
}

export function assertThrows(code, type_opt, cause_opt) {
  let threw = false;
  try {
    if (typeof code === "function") code();
    else (0, eval)(code);
  } catch (e) {
    threw = true;
    if (type_opt !== undefined && typeof type_opt === "function" && !(e instanceof type_opt)) {
      throw new MjsUnitAssertionError(
        `assertThrows: threw ${e && e.constructor ? e.constructor.name : typeof e}, expected ${type_opt.name}`,
      );
    }
    if (cause_opt !== undefined) {
      if (typeof cause_opt === "string" && e.message !== cause_opt) {
        throw new MjsUnitAssertionError(`assertThrows: message ${fmt(e.message)}, expected ${fmt(cause_opt)}`);
      } else if (cause_opt instanceof RegExp && !cause_opt.test(e.message)) {
        throw new MjsUnitAssertionError(`assertThrows: message ${fmt(e.message)}, expected ${cause_opt}`);
      }
    }
  }
  if (!threw)
    throw new MjsUnitAssertionError(`assertThrows: did not throw` + (type_opt ? ` ${type_opt.name || ""}` : ""));
}

export function assertDoesNotThrow(code, name_opt) {
  try {
    if (typeof code === "function") code();
    else (0, eval)(code);
  } catch (e) {
    throw new MjsUnitAssertionError(`assertDoesNotThrow: threw ${e}` + (name_opt ? ` - ${name_opt}` : ""));
  }
}

export function assertInstanceof(obj, type) {
  if (!(obj instanceof type)) {
    throw new MjsUnitAssertionError(`assertInstanceof: ${fmt(obj)} is not an instance of ${type.name || type}`);
  }
}

export function assertUnreachable(name_opt) {
  throw new MjsUnitAssertionError("Unreachable code" + (name_opt ? ` - ${name_opt}` : ""));
}

// assertEarlyError(source): `source` must be a SyntaxError at parse time.
// Wrapping the source in a function body distinguishes an early (parse-time)
// error from a runtime one: the function is never called.
export function assertEarlyError(source) {
  let threw = null;
  try {
    (0, eval)(`function __shim_early_error_probe__() {\n${source}\n}`);
  } catch (e) {
    threw = e;
  }
  if (!(threw instanceof SyntaxError)) {
    throw new MjsUnitAssertionError(
      `assertEarlyError: expected early SyntaxError for ${fmt(source)}, got ${threw ? threw.constructor.name : "no error"}`,
    );
  }
}

// assertThrowsAtRuntime(source, type): parses fine, but throws `type` when run.
export function assertThrowsAtRuntime(source, type) {
  // Must parse successfully...
  try {
    (0, eval)(`function __shim_runtime_error_probe__() {\n${source}\n}`);
  } catch (e) {
    throw new MjsUnitAssertionError(`assertThrowsAtRuntime: ${fmt(source)} failed to parse: ${e}`);
  }
  // ...and throw the expected type when executed.
  assertThrows(source, type);
}

// Install the API on globalThis so vendored test files (which use these as
// free functions) run unmodified.
export function installMjsUnitGlobals(target = globalThis) {
  const api = {
    assertEquals,
    assertNotEquals,
    assertSame,
    assertTrue,
    assertFalse,
    assertNull,
    assertNotNull,
    assertArrayEquals,
    assertThrows,
    assertDoesNotThrow,
    assertInstanceof,
    assertUnreachable,
    assertEarlyError,
    assertThrowsAtRuntime,
  };
  for (const [name, fn] of Object.entries(api)) target[name] = fn;
  return api;
}
