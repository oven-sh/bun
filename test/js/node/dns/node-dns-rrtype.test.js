import { describe, expect, it } from "bun:test";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";

// https://github.com/oven-sh/bun/issues/39553
// Node validates rrtype case-sensitively: 'a' is invalid, only 'A' works.
// These tests are in their own file because the validation throws before any
// DNS query is issued, so they do not need network access.
describe.each([
  ["dns.resolve", rrtype => dns.resolve("localhost", rrtype, () => {})],
  ["dns.Resolver#resolve", rrtype => new dns.Resolver().resolve("localhost", rrtype, () => {})],
  ["dns.promises.resolve", rrtype => dns_promises.resolve("localhost", rrtype)],
  ["dns.promises.Resolver#resolve", rrtype => new dns_promises.Resolver().resolve("localhost", rrtype)],
])("%s", (_, fn) => {
  it.each(["a", "aaaa", "txt", "Mx", ""])("with rrtype %p throws ERR_INVALID_ARG_VALUE", rrtype => {
    expect(() => fn(rrtype)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: `The argument 'rrtype' is invalid. Received '${rrtype}'`,
      }),
    );
  });

  it.each(["A", "AAAA", "ANY", "CAA", "CNAME", "MX", "NS", "PTR", "SOA", "SRV", "TXT"])(
    "with rrtype %p does not throw synchronously",
    rrtype => {
      // The query itself may fail depending on the environment's resolver.
      // Only the synchronous validation is under test here.
      const result = fn(rrtype);
      if (result instanceof Promise) {
        result.catch(() => {});
      }
    },
  );
});

it("dns.promises.Resolver#resolve with non-string rrtype throws ERR_INVALID_ARG_TYPE", () => {
  expect(() => new dns_promises.Resolver().resolve("localhost", 1)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "rrtype" argument must be of type string'),
    }),
  );
});
