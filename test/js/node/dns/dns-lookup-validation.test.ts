// Argument validation for dns.lookup()/dns.promises.lookup(), checked against
// Node.js. Everything here resolves out of the hosts file or fails before the
// resolver is reached, so the file never touches the network.
import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";
import * as dns from "node:dns";
import * as dnsPromises from "node:dns/promises";
import * as util from "node:util";

// Both entry points validate synchronously, so a thrown error and a rejected
// promise are the same failure. Returns the resolved value when there is none.
async function promisesError(options: unknown, hostname = "localhost") {
  try {
    return await dnsPromises.lookup(hostname, options as any);
  } catch (error) {
    return error;
  }
}

function callbackError(options: unknown, hostname = "localhost") {
  const { promise, resolve } = Promise.withResolvers<any>();
  try {
    dns.lookup(hostname, options as any, (err, address, family) => resolve(err ?? { address, family }));
  } catch (error) {
    resolve(error);
  }
  return promise;
}

describe("dns.lookup option validation", () => {
  it.each([
    ["IPv4", "The property 'options.family' must be one of: 0, 4, 6. Received 'IPv4'"],
    ["IPv6", "The property 'options.family' must be one of: 0, 4, 6. Received 'IPv6'"],
    ["ipv4", "The property 'options.family' must be one of: 0, 4, 6. Received 'ipv4'"],
    ["4", "The property 'options.family' must be one of: 0, 4, 6. Received '4'"],
  ])("dns.promises.lookup rejects the string family %p", async (family, message) => {
    const error = await promisesError({ family });
    expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE", name: "TypeError" });
    expect(error.message).toBe(message);
  });

  it("dns.promises.lookup rejects an out of range numeric family", async () => {
    const error = await promisesError({ family: 20 });
    expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE", name: "TypeError" });
    expect(error.message).toBe("The property 'options.family' must be one of: 0, 4, 6. Received 20");
  });

  it("dns.lookup (callback) keeps accepting the IPv4/IPv6 family spellings, like Node.js", async () => {
    // localhost always has a 127.0.0.1 entry, so this reaches the resolver with AF_INET.
    expect(await callbackError({ family: "IPv4" })).toMatchObject({ address: expect.any(String), family: 4 });
    // An IP literal short-circuits before the resolver, so no "::1 localhost" entry is needed.
    expect(await callbackError({ family: "IPv6" }, "::1")).toEqual({ address: "::1", family: 6 });
    // Only those two spellings.
    expect(await callbackError({ family: "ipv4" })).toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
      message: "The property 'options.family' must be one of: 0, 4, 6. Received 'ipv4'",
    });
  });

  it("util.promisify(dns.lookup) wraps the callback implementation, like Node.js", async () => {
    expect(dns.lookup[util.promisify.custom]).toBeUndefined();
    const lookup = util.promisify(dns.lookup);

    // ...so it accepts the family spellings that dns.promises.lookup rejects.
    expect(await lookup("localhost", { family: "IPv4" })).toMatchObject({ address: expect.any(String), family: 4 });
    // A single callback value stays itself rather than becoming { address, family }.
    expect(await lookup("localhost", { all: true })).toBeArray();
    expect(await lookup("127.0.0.1")).toEqual({ address: "127.0.0.1", family: 4 });
  });

  it.each([
    ["all", { all: 1 }, `The "options.all" property must be of type boolean. Received type number (1)`],
    [
      "verbatim",
      { verbatim: "yes" },
      `The "options.verbatim" property must be of type boolean. Received type string ('yes')`,
    ],
    ["hints", { hints: "x" }, `The "options.hints" property must be of type number. Received type string ('x')`],
  ])("names options.%s in its ERR_INVALID_ARG_TYPE", async (_option, options, message) => {
    for (const error of [await promisesError(options), await callbackError(options)]) {
      expect(error).toMatchObject({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" });
      expect(error.message).toBe(message);
    }
  });

  it("names the offending property in the ERR_INVALID_ARG_VALUE of a bad order", async () => {
    const message = "The property 'options.order' must be one of: 'verbatim', 'ipv4first', 'ipv6first'. Received 'x'";
    for (const error of [await promisesError({ order: "x" }), await callbackError({ order: "x" })]) {
      expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE", name: "TypeError" });
      expect(error.message).toBe(message);
    }
  });

  it("a numeric family argument is still named 'family'", async () => {
    const error = await promisesError(5);
    expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE", name: "TypeError" });
    expect(error.message).toBe("The argument 'family' must be one of: 0, 4, 6. Received 5");
  });

  it("dns.setDefaultResultOrder rejects an unknown order", () => {
    const message = "The argument 'dnsOrder' must be one of: 'verbatim', 'ipv4first', 'ipv6first'. Received 'x'";
    expect(() => dns.setDefaultResultOrder("x" as any)).toThrow(message);
    expect(() => dnsPromises.setDefaultResultOrder("x" as any)).toThrow(message);
  });

  it("a null option means unset, like Node.js", async () => {
    const options = { family: null, all: null, verbatim: null, hints: null, order: null };
    expect(await promisesError(options)).toMatchObject({ address: expect.any(String) });
    expect(await callbackError(options)).toMatchObject({ address: expect.any(String) });
  });
});

describe("dns.lookup of a hostname longer than 255 characters", () => {
  const MAX_HOSTNAME_LENGTH = 255;
  const hostname = Buffer.alloc(MAX_HOSTNAME_LENGTH + 1, "l").toString();

  // getaddrinfo cannot encode it, so Node.js reports EINVAL instead of the
  // ENOTFOUND a missing (but encodable) hostname gets.
  const expected = {
    code: "EINVAL",
    errno: isWindows ? -4071 : -22,
    syscall: "getaddrinfo",
    hostname,
    message: `getaddrinfo EINVAL ${hostname}`,
  };

  it("dns.promises.lookup rejects with EINVAL", async () => {
    const error = await promisesError(undefined, hostname);
    expect(error).toMatchObject(expected);
    expect(error.name).toBe("Error");
  });

  it("dns.promises.lookup rejects with EINVAL with { all: true }", async () => {
    expect(await promisesError({ all: true }, hostname)).toMatchObject(expected);
  });

  it("dns.lookup (callback) passes EINVAL to the callback, asynchronously", async () => {
    const { promise, resolve } = Promise.withResolvers<any>();
    let calledSynchronously = true;
    dns.lookup(hostname, (err, address) => resolve({ err, address, calledSynchronously }));
    calledSynchronously = false;

    const { err, address, calledSynchronously: sync } = await promise;
    expect(err).toMatchObject(expected);
    expect(address).toBeUndefined();
    expect(sync).toBe(false);
  });

  it("a hostname whose IDNA encoding still fits reaches the resolver", async () => {
    // 128 astral code points: 256 UTF-16 code units, but only 135 bytes of IDNA
    // ASCII ("xn--971h" + 127 deltas), which getaddrinfo encodes happily.
    const surrogates = "\u{1D54F}".repeat(128);
    expect(surrogates.length).toBeGreaterThan(MAX_HOSTNAME_LENGTH);
    expect((await promisesError(undefined, surrogates))?.code).not.toBe("EINVAL");
  });

  it("a 255 character hostname still reaches the resolver", async () => {
    // It cannot exist, so this only asserts that it was not rejected as EINVAL.
    const shorter = Buffer.alloc(MAX_HOSTNAME_LENGTH, "l").toString();
    const error = await new Promise<any>(resolve => dns.lookup(shorter, resolve));
    expect(error?.code).not.toBe("EINVAL");
  });
});
