// Fixes for isArray() + jsCast<JSArray*> / jsDynamicCast<JSArray*> null dereference crashes.
//
// JSC::isArray() returns true for Proxy wrapping an Array (per ECMA-262 IsArray).
// But jsCast<JSArray*> on a Proxy is a type confusion (debug assertion / release UB),
// and jsDynamicCast<JSArray*> returns nullptr for Proxy.
//
// Before this fix, several APIs would crash with a segfault when given a Proxy
// wrapping an Array:
//   - Buffer.concat(new Proxy([], {})) -> SEGV at 0x4
//   - process.setgroups(new Proxy([], {})) -> SEGV at 0x4
//   - vm.compileFunction("", new Proxy([], {})) -> debug assertion
//   - new Bun.CookieMap(new Proxy([], {})) -> debug assertion
//   - expect(proxy).toEqual(expect.arrayContaining([...])) -> UBSan null deref

import { describe, expect, test } from "bun:test";
import vm from "vm";

describe("isArray + Proxy crash fixes", () => {
  test("Buffer.concat accepts empty Proxy-wrapped array", () => {
    // Node.js returns an empty buffer here; before the fix, Bun would SEGV.
    const result = Buffer.concat(new Proxy([], {}));
    expect(result.length).toBe(0);
  });

  test("Buffer.concat iterates Proxy-wrapped array correctly", () => {
    // Node.js compatibility: Proxy-wrapped arrays should be iterated via get() traps.
    const b = Buffer.from("hi");
    const result = Buffer.concat(new Proxy([b, b], {}));
    expect(result.toString()).toBe("hihi");
  });

  test("Buffer.concat with Proxy get trap", () => {
    const b1 = Buffer.from("foo");
    const b2 = Buffer.from("bar");
    const accesses: string[] = [];
    const list = new Proxy([b1, b2], {
      get(target, prop, receiver) {
        accesses.push(String(prop));
        return Reflect.get(target, prop, receiver);
      },
    });
    const result = Buffer.concat(list);
    expect(result.toString()).toBe("foobar");
    // Must access length and indices via Proxy traps
    expect(accesses).toContain("length");
    expect(accesses).toContain("0");
    expect(accesses).toContain("1");
  });

  test.skipIf(process.platform === "win32")("process.setgroups throws TypeError for Proxy (no crash)", () => {
    // Node.js also rejects Proxy here (with a native assertion). We throw a TypeError.
    expect(() => process.setgroups(new Proxy([], {}))).toThrow(TypeError);
  });

  test("vm.compileFunction throws for Proxy params (no crash)", () => {
    // Before: debug assertion in jsCast<JSArray*>. Now: proper TypeError.
    expect(() => vm.compileFunction("return 1", new Proxy([], {}))).toThrow();
  });

  test("vm.compileFunction throws for Proxy contextExtensions (no crash)", () => {
    expect(() =>
      vm.compileFunction("return 1", [], {
        contextExtensions: new Proxy([], {}),
      }),
    ).toThrow();
  });

  test("new Bun.CookieMap does not crash with Proxy-wrapped array", () => {
    // Before: debug assertion in jsCast<JSArray*>. Now: falls through to record path.
    // A Proxy wrapping [] has no own enumerable string keys, so this yields an empty map.
    const map = new Bun.CookieMap(new Proxy([], {}));
    expect(map.size).toBe(0);
  });

  test("expect.arrayContaining does not crash with Proxy receiver", () => {
    // Before: UBSan null deref on otherArray->length(). Now: FAIL (doesn't match).
    const proxy = new Proxy([1, 2, 3], {});
    // Proxy is not a real JSArray, so arrayContaining matcher falls to FAIL path.
    // The important thing is: no crash.
    expect(() => {
      expect(proxy).toEqual(expect.arrayContaining([1]));
    }).toThrow(); // toEqual assertion fails, but process doesn't crash
  });

  test("expect.arrayContaining with Proxy expected value does not crash", () => {
    const proxyExpected = new Proxy([1], {});
    expect(() => {
      expect([1, 2, 3]).toEqual(expect.arrayContaining(proxyExpected));
    }).toThrow(); // assertion fails, no crash
  });
});
