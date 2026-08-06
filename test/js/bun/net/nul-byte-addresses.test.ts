// Hostnames, IP addresses, and SNI servernames become NUL-terminated C
// strings at the resolver/connect boundary (getaddrinfo, ares_inet_pton,
// SSL_set_tlsext_host_name). A JS string containing an embedded NUL
// ("127.0.0.1\0evil.example.com") would silently truncate there, so the
// socket goes to "127.0.0.1" while JS-level allow/deny-list checks see the
// full string. Every entry point must reject instead.
//
// Unix socket paths have the same defect; that surface is fixed separately
// with an EINVAL at the usockets layer.
//
// These tests are hermetic (no external DNS, no internet): after the fix each
// rejection is pure input validation that fires before any I/O.
import { connect } from "bun";
import { describe, expect, it } from "bun:test";
import dns from "node:dns";

describe.concurrent("NUL bytes in addresses are rejected, not truncated", () => {
  it("dns.promises.lookupService rejects an address containing a NUL", async () => {
    // "127.0.0.1\0..." must not be treated as "127.0.0.1" (node throws
    // ERR_INVALID_ARG_VALUE for any address that is not an IP literal).
    let err: any;
    try {
      await dns.promises.lookupService("127.0.0.1\0.example.invalid", 80);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ARG_VALUE");
  });

  it("dns.lookupService (callback) rejects an address containing a NUL", () => {
    expect(() => dns.lookupService("127.0.0.1\0.example.invalid", 80, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("dns.promises.reverse rejects an IP containing a NUL", async () => {
    // Must fail like any other unparseable IP (dns.reverse("zzz") -> ENOTIMP),
    // not PTR-query the "8.8.8.8" prefix.
    let err: any;
    try {
      await dns.promises.reverse("8.8.8.8\0.example.invalid");
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ENOTIMP");
  });

  it("resolver.setLocalAddress rejects an IP containing a NUL", () => {
    const resolver = new dns.Resolver();
    expect(() => resolver.setLocalAddress("127.0.0.1\0.example.invalid")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_IP_ADDRESS" }),
    );
  });

  it("Bun.connect({ tls: { serverName } }) rejects a serverName containing a NUL byte", async () => {
    // The serverName becomes the C string handed to SSL_set_tlsext_host_name,
    // so "good.example\0evil" would silently send "good.example" on the wire.
    // Reserved port 1: nothing listens there in CI, and the check must refuse
    // before any connection attempt anyway.
    let err: any;
    try {
      const socket = await connect({
        hostname: "127.0.0.1",
        port: 1,
        tls: { serverName: "localhost\0.example.invalid", rejectUnauthorized: false },
        socket: { data() {} },
      });
      socket.end();
    } catch (e) {
      err = e;
    }
    expect(err?.message).toContain("must not contain null bytes");
  });
});
