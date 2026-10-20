// node-dns.test.js resolves public hostnames. These tests need no network.
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import dns from "node:dns";

describe.each([
  ["dns.Resolver", dns.Resolver],
  ["dns.promises.Resolver", dns.promises.Resolver],
])("%s", (_name, Resolver: any) => {
  test("an instance has Resolver.prototype", () => {
    const resolver = new Resolver();
    expect(Object.getPrototypeOf(resolver)).toBe(Resolver.prototype);
    expect(resolver.constructor).toBe(Resolver);
  });

  test("a subclass instance has the subclass prototype and its own servers", () => {
    class PinnedResolver extends Resolver {
      getServers() {
        return super.getServers().map((server: string) => `pinned ${server}`);
      }
    }

    const resolver = new (PinnedResolver as any)({ timeout: 1000, tries: 1 });
    expect(Object.getPrototypeOf(resolver)).toBe(PinnedResolver.prototype);
    expect(resolver).toBeInstanceOf(Resolver);

    resolver.setServers(["192.0.2.1"]);
    expect(resolver.getServers()).toEqual(["pinned 192.0.2.1"]);
    expect(dns.getServers()).not.toContain("192.0.2.1");
  });

  test("throws a TypeError when called without new", () => {
    expect(() => Resolver()).toThrow(TypeError);
  });

  test.each([
    ["resolve", "ERR_INVALID_ARG_TYPE"],
    ["resolveAny", "ERR_INVALID_ARG_TYPE"],
    ["resolveCaa", "ERR_INVALID_ARG_TYPE"],
    ["resolveCname", "ERR_INVALID_ARG_TYPE"],
    ["resolveMx", "ERR_INVALID_ARG_TYPE"],
    ["resolveNaptr", "ERR_INVALID_ARG_TYPE"],
    ["resolveNs", "ERR_INVALID_ARG_TYPE"],
    ["resolvePtr", "ERR_INVALID_ARG_TYPE"],
    ["resolveSoa", "ERR_INVALID_ARG_TYPE"],
    ["resolveSrv", "ERR_INVALID_ARG_TYPE"],
    ["resolveTxt", "ERR_INVALID_ARG_TYPE"],
    ["reverse", "ERR_INVALID_ARG_TYPE"],
    ["setLocalAddress", "ERR_INVALID_IP_ADDRESS"],
    ["setServers", "ERR_INVALID_ARG_TYPE"],
  ])("_handle.%s() treats a missing argument as undefined", (method, code) => {
    const handle = new Resolver()._handle;
    const thrownBy = (...args: undefined[]) => {
      try {
        handle[method](...args);
      } catch (error: any) {
        return { name: error.name, code: error.code, message: error.message };
      }
    };
    expect(thrownBy()).toEqual({ name: "TypeError", code, message: expect.any(String) });
    expect(thrownBy()).toEqual(thrownBy(undefined));
  });

  test("_handle.setLocalAddress() converts both arguments before it checks the first", () => {
    expect(() => new Resolver()._handle.setLocalAddress("a.test", Symbol())).toThrow(
      "Cannot convert a symbol to a string",
    );
  });

  test("the size of _handle includes the native resolver", () => {
    expect(estimateShallowMemoryUsageOf(new Resolver()._handle)).toBeGreaterThan(1024);
  });
});
