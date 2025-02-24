import { isIP, isIPv4, isIPv6 } from "node:net";
import { describe, beforeEach, it, expect } from "bun:test";

// common tests
describe.each(
  [isIP, isIPv4, isIPv6].map(fn => [fn.name, fn] as const), // for pretty test names
)("net.%s", (_name, fn) => {
  const NOT_IP = fn === isIP ? 0 : false;

  // bad values
  it.each([undefined, null, NaN, 0, 1, true, false, {}, function foo() {}])(
    "given invalid input, returns false (%p)",
    (input: any) => {
      expect(fn(input)).toBe(NOT_IP);
    },
  );

  it(`when called without any arguments, returns ${NOT_IP}`, () => {
    // @ts-expect-error -- intentionally testing without arguments
    expect(fn()).toBe(NOT_IP);
  });

  it.each(["", "foobar", "1", "localhost", "www.example.com"])(
    "does not consider %p to be an ip address",
    (input: string) => {
      expect(fn(input)).toBe(NOT_IP);
    },
  );

  it.each(["127.0.0.1/24"])("CIDR blocks are not IP addresses", (cidr: string) => {
    expect(fn(cidr)).toBe(NOT_IP);
  });
}); // </net.isIP*>

// valid and well formed (but invalid) IPv4 addresses
describe("IP version 4", () => {
  describe.each([
    "127.0.0.1", //
    "0.0.0.0",
    "255.255.255.255",
  ])("given a valid address", (input: string) => {
    it(`net.isIPv4("${input}") === true`, () => {
      expect(isIPv4(input)).toBe(true);
    });

    it(`net.isIP("${input}") === 4`, () => {
      expect(isIP(input)).toBe(4);
    });

    it(`net.isIPv6("${input}") === false`, () => {
      expect(isIPv6(input)).toBe(false);
    });
  }); // </valid>

  describe.each(["256.256.256.256", "-1.0.0.0", "127.000.000.001"])(
    "given a well-formed but invalid address",
    (input: string) => {
      it(`net.isIPv4("${input}") === false`, () => {
        expect(isIPv4(input)).toBe(false);
      });

      it(`net.isIP("${input}") === 0`, () => {
        expect(isIP(input)).toBe(0);
      });

      it(`net.isIPv6("${input}") === false`, () => {
        expect(isIPv6(input)).toBe(false);
      });
    },
  ); // </well-formed but invalid>
}); // </IPv4>

describe("IP version 6", () => {
  describe.each([
    "::1",
    "0:0:0:0:0:0:0:1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334", //
  ])("given a valid address", (input: string) => {
    it(`net.isIPv6("${input}") === true`, () => {
      expect(isIPv6(input)).toBe(true);
    });

    it(`net.isIP("${input}") === 6`, () => {
      expect(isIP(input)).toBe(6);
    });

    it(`net.isIPv4("${input}") === false`, () => {
      expect(isIPv4(input)).toBe(false);
    });
  });
});
