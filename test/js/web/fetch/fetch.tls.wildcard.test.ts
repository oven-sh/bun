import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import tls from "node:tls";

// This test verifies that wildcard certificate hostname matching follows RFC 6125 Section 6.4.3:
// - Wildcards must match exactly one label (not multiple labels)
// - *.example.com should match foo.example.com but NOT sub.foo.example.com
// - *.com should NOT match example.com (wildcard TLDs are disallowed)
// RFC 4343: DNS names are case-insensitive

// Generated with:
// openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
//   -subj "/CN=*.example.com" -addext "subjectAltName = DNS:*.example.com" -days 3650

const wildcardExampleComTls = Object.freeze({
  cert: `-----BEGIN CERTIFICATE-----
MIIDKzCCAhOgAwIBAgIUTraxlxwHeiydL/3a/wPWpf1qA6gwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNKi5leGFtcGxlLmNvbTAeFw0yNTEyMjgwMzM2NTlaFw0z
NTEyMjYwMzM2NTlaMBgxFjAUBgNVBAMMDSouZXhhbXBsZS5jb20wggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDJsp+CYFFfo/FTVnZj/kIXvl0BPEEjfcwB
uKhIgcdtax5jrvT4nExo0B1guORnbC6SogxvOEUHhg70fwLz8vfZIUk+Y7e1oNRM
POZLxoshRxyJTQpd/H0xT8GAa0o9TZRhxFt3a6pE0Dvqo6k838eBikOG3uEhcRSd
nXyRYARG2UPLfE3A9wNuBkaeYMv80FwgRhykgSZnWmh2INhzgTcu9jyJdgOlZRrF
5ffFvo8WV9iRIsHOnK+rcvTwKesJG2YrIVZ7caTi5NudwWT97VoH8dYURnlEWZo0
2LxO2oy/6dC5tRMPxGICbQsXD+5Yc+t8LApF5xffjrvhwQEYDCBJAgMBAAGjbTBr
MB0GA1UdDgQWBBRJby0JRg7WhqGmLO8y1iZ0V/1/WDAfBgNVHSMEGDAWgBRJby0J
Rg7WhqGmLO8y1iZ0V/1/WDAPBgNVHRMBAf8EBTADAQH/MBgGA1UdEQQRMA+CDSou
ZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBACWYXg2MDcjDHe8PP8vjykxM
Eb0jFR0jOxHZVEtDpeLRwFVZzjjht1GmYx1cgxzWRZykY2rXKuAYTchcdIkeXkAm
kTVbNzDyqAfoCBLl0f5ypeU950STgJe02Y0hedQioB5Kc0EpoKEJMugiJEB2wSt/
D1V/sAk3XyUUAyq4x41R3NvD7/gO88tBlCO/jpjq/+Y8p+sQDjjIw/U/Mg4FfHtV
EyGVgYX3rdfFq2EjNc7dKmoKeo9p0v1prjIZLdWCDbyMlvh9mwihCHApE/2M0G/1
3jpCvfD5gktjGawop/43zoNxtL+mpixRCLSVjjaMLxG2ckJHQwTz8AEoet/e7OM=
-----END CERTIFICATE-----`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDJsp+CYFFfo/FT
VnZj/kIXvl0BPEEjfcwBuKhIgcdtax5jrvT4nExo0B1guORnbC6SogxvOEUHhg70
fwLz8vfZIUk+Y7e1oNRMPOZLxoshRxyJTQpd/H0xT8GAa0o9TZRhxFt3a6pE0Dvq
o6k838eBikOG3uEhcRSdnXyRYARG2UPLfE3A9wNuBkaeYMv80FwgRhykgSZnWmh2
INhzgTcu9jyJdgOlZRrF5ffFvo8WV9iRIsHOnK+rcvTwKesJG2YrIVZ7caTi5Nud
wWT97VoH8dYURnlEWZo02LxO2oy/6dC5tRMPxGICbQsXD+5Yc+t8LApF5xffjrvh
wQEYDCBJAgMBAAECggEAAfyJgThsi2ljJh0Y7Xyanx7TuMBZ9gz7f60CB58d7Sl+
iys0/txU4nzh5zBBpp+cWKXHgye97U2q6Mn18rFgSHIL8BUoa727DYpVgdD20T52
LQeBAZfhTe/78cVMvexn+KuyiMCa6hKAyTuF/jidf5ynyYSj2WdCgC1l2vguk+80
IgJmk9G8OA1RwMGI4KSgTA8GL8E3InYMHBTjeEZVAZTWZMpTeaTOQ0RR4g1/jY31
fnINNnqJdhkV8IqaJ0rsb1j1Lqdl27s1CdxnBn/ChKGZ5xvj4lGORpK6fuNo1qAr
2tqUR4VQ97mAgYzJa1ts+INKAL76h/XJe8+E0c7BgQKBgQDotnXe1tlPrL/1oVAU
urOemTfeT/A4Jt3rNC318bwW7ejUXEKtt4BgyBECHZUQpzww7d0s5SUrKsiHJ7p1
J4fnHcUL1ivLSOmVmHVZR1nDJVLSH4vpksADTsaOr7v8CiqpsHN4rfnTsVFzhAx4
CmKaSwIeHk72BO1gmsshThh2yQKBgQDd4aIjI7MphN/ePLDhOqyanjaEwGLExLgW
BRXQ+XY4TOF1WLES4T0xWDYavddined2wnASmDn7qmhYFXY1UuVCB+Zm3D0aYXRA
IIWVdgvOpzakWpv90i3z/I+Ux0PS0L7yAvxwjH0jMofcGjXDF61Fx9dnPanWSibj
48FrYmedgQKBgQCE/YkdAXGNW+8T481NG2l9EJjh/pMMtAGM4fQGItDX1byCZ/tf
JYhDRvKZX+iJbNk0KSuF9aopIjkZLDYdr6q2BMhQPGQot5FuAYPGssT0hgbvuEGQ
CWKcQU+tyXZH0lORSBqlc99bAHHI70Tk8SJqhMVACxga9rPlynCdpvDKKQKBgASP
daipPC53R66mqrAGZ7PJ2q8B0UXgETSKqDciWXawxdWGnCUaMgrImFwWWM3zFuXO
+0S2kkKE7x4YWtSfvoyL4wVsM2lOZXhH8tbulTGLKElaf2hJIJ6qKz1QlylHFxWc
UBn0GUJW8Inqk/5Nh0cu41OA5fO8lG4MqVYOsLiBAoGAWTn1YOw/xuc1RSsEK0DZ
Lb1Qlohgz1p8gjuVbuVdhgfdlO8m2xIlcmxN3FMJRZtStEgNw/R+wLds+8yFAmJd
Wm0ej4ypjPIL2vvuvD2jj2a7EohmPgUH5BtEIbm3P0A87z9e6PUJETNDnuSZ5ZRz
17Y8hXpLewWsDckPzB4wZLc=
-----END PRIVATE KEY-----`,
});

describe.concurrent("TLS wildcard hostname verification", () => {
  // These tests use tls.connect with servername to test hostname verification.
  // The servername is sent in the TLS handshake and verified against the cert's SAN.
  // This tests both native and JS paths depending on whether checkServerIdentity is provided.

  it("should reject multi-label wildcard match (sub.foo.example.com vs *.example.com)", async () => {
    // Create a server with the wildcard cert, then try to connect with a multi-label servername
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    // Use tls.connect with servername that should NOT match the wildcard
    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "sub.foo.example.com", // Multi-label - should NOT match *.example.com
        rejectUnauthorized: true,
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Hostname/IP does not match");
  });

  it("should accept valid single-label wildcard match (foo.example.com vs *.example.com)", async () => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "foo.example.com", // Single-label - SHOULD match *.example.com
        rejectUnauthorized: true,
      });

      socket.on("secureConnect", () => {
        socket.end();
        resolve({ success: true });
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject bare domain for wildcard cert (example.com vs *.example.com)", async () => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "example.com", // Bare domain - should NOT match *.example.com
        rejectUnauthorized: true,
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Hostname/IP does not match");
  });

  it("should accept exact match for wildcard labels (bar.example.com vs *.example.com)", async () => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "bar.example.com", // Single-label - SHOULD match *.example.com
        rejectUnauthorized: true,
      });

      socket.on("secureConnect", () => {
        socket.end();
        resolve({ success: true });
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject deeply nested subdomain (a.b.c.example.com vs *.example.com)", async () => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "a.b.c.example.com", // Multi-label - should NOT match *.example.com
        rejectUnauthorized: true,
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Hostname/IP does not match");
  });

  it("should accept case-insensitive wildcard match (FOO.EXAMPLE.COM vs *.example.com)", async () => {
    // RFC 4343: DNS names are case-insensitive
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "FOO.EXAMPLE.COM", // Mixed case - SHOULD match *.example.com per RFC 4343
        rejectUnauthorized: true,
      });

      socket.on("secureConnect", () => {
        socket.end();
        resolve({ success: true });
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should accept mixed-case wildcard match (FoO.ExAmPlE.cOm vs *.example.com)", async () => {
    // RFC 4343: DNS names are case-insensitive
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const tls = await import("node:tls");

    const result = await new Promise<{ success: boolean; error?: Error }>(resolve => {
      const socket = tls.connect({
        host: "127.0.0.1",
        port: server.port,
        ca: wildcardExampleComTls.cert,
        servername: "FoO.ExAmPlE.cOm", // Mixed case - SHOULD match *.example.com per RFC 4343
        rejectUnauthorized: true,
      });

      socket.on("secureConnect", () => {
        socket.end();
        resolve({ success: true });
      });

      socket.on("error", err => {
        socket.destroy();
        resolve({ success: false, error: err });
      });
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // UTS #46 maps three code points to ".", so a resolver that applies IDNA
  // looks up "foo.bar.example.com", two labels below example.com (Node.js
  // CVE-2026-48618). The mapping must not be a URL host parse: that stops at
  // "/" and would match "foo.example.com". U+FF46 maps to "f" and sends the
  // name through the IDNA mapping of both matchers.
  const rejectedServernames = [
    ["a U+3002 full stop", "foo\u3002bar.example.com"],
    ["a U+FF0E full stop", "foo\uff0ebar.example.com"],
    ["a U+FF61 full stop", "foo\uff61bar.example.com"],
    ["a URL path", "foo.example.com/x.evil.test"],
    ["a URL path after a non-ASCII label", "\uff46oo.example.com/x.evil.test"],
  ];

  it.each(rejectedServernames)("tls.connect should reject %s in servername", async (_name, servername) => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const { promise, resolve } = Promise.withResolvers<unknown>();
    const socket = tls.connect({
      host: "127.0.0.1",
      port: server.port,
      ca: wildcardExampleComTls.cert,
      servername,
    });
    socket.on("secureConnect", () => resolve({ authorized: socket.authorized }));
    socket.on("error", resolve);
    try {
      expect(await promise).toMatchObject({
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        host: servername,
        message:
          "Hostname/IP does not match certificate's altnames: " +
          `Host: ${servername}. is not in the cert's altnames: DNS:*.example.com`,
      });
    } finally {
      socket.destroy();
    }
  });

  it.each(rejectedServernames)("Bun.connect should reject %s in tls.serverName", async (_name, serverName) => {
    using server = Bun.serve({
      port: 0,
      tls: wildcardExampleComTls,
      fetch() {
        return new Response("Hello");
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      tls: { ca: wildcardExampleComTls.cert, serverName },
      socket: {
        handshake(s, success) {
          const error = s.getAuthorizationError();
          resolve({ success, authorized: s.authorized, code: error?.code, message: error?.message });
        },
        data() {},
        error(_s, err) {
          reject(err);
        },
        connectError(_s, err) {
          reject(err);
        },
        close() {
          reject(new Error("closed before the handshake callback"));
        },
      },
    });
    try {
      expect(await promise).toEqual({
        success: false,
        authorized: false,
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
        message:
          "Hostname/IP does not match certificate's altnames: " +
          `Host: ${serverName}. is not in the cert's altnames: DNS:*.example.com`,
      });
    } finally {
      socket.end();
    }
  });
});

// Bun exposes three certificate-name matchers that must agree with Node.js:
//   - tls.checkServerIdentity()  -> JS port of Node lib/tls.js check()
//   - fetch() / WebSocket / Bun.connect / SQL -> native Rust port of check()
//   - X509Certificate#checkHost  -> native port of OpenSSL X509_check_host
// The first two share semantics; checkHost follows OpenSSL where Node does.
// Every expected value below was taken from Node.js v26.3.0, unless a comment
// names a later version.
describe("TLS certificate name matching: fetch() / checkServerIdentity / checkHost agree", () => {
  // Minimal DER encoder sufficient to build a self-signed EC certificate with
  // an arbitrary subjectAltName. Real CAs don't issue partial-wildcard SANs,
  // so the test has to mint its own.
  const tlv = (t: number, b: Buffer) => {
    const l =
      b.length < 0x80
        ? Buffer.from([b.length])
        : b.length < 0x100
          ? Buffer.from([0x81, b.length])
          : Buffer.from([0x82, b.length >> 8, b.length & 0xff]);
    return Buffer.concat([Buffer.from([t]), l, b]);
  };
  const seq = (...b: Buffer[]) => tlv(0x30, Buffer.concat(b));
  const set = (b: Buffer) => tlv(0x31, b);
  const oid = (h: string) => tlv(0x06, Buffer.from(h, "hex"));
  const ecdsaWithSha256 = seq(oid("2a8648ce3d040302"));
  const dn = (cn: string) => seq(set(seq(oid("550403"), tlv(0x0c, Buffer.from(cn)))));

  type San = ["dns" | "ip" | "email" | "uri", string];
  function makeCert(cn: string, sans: San[]) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const subject = dn(cn);
    let exts = Buffer.alloc(0);
    if (sans.length) {
      const enc: Record<San[0], (v: string) => Buffer> = {
        dns: v => tlv(0x82, Buffer.from(v)),
        ip: v => tlv(0x87, Buffer.from(v.split(".").map(Number))),
        email: v => tlv(0x81, Buffer.from(v)),
        uri: v => tlv(0x86, Buffer.from(v)),
      };
      exts = tlv(0xa3, seq(seq(oid("551d11"), tlv(0x04, seq(...sans.map(([t, v]) => enc[t](v)))))));
    }
    const tbs = seq(
      tlv(0xa0, tlv(0x02, Buffer.from([2]))),
      tlv(0x02, Buffer.from([9])),
      ecdsaWithSha256,
      subject,
      seq(tlv(0x17, Buffer.from("240101000000Z")), tlv(0x17, Buffer.from("340101000000Z"))),
      subject,
      publicKey.export({ type: "spki", format: "der" }) as Buffer,
      exts,
    );
    const der = seq(
      tbs,
      ecdsaWithSha256,
      tlv(0x03, Buffer.concat([Buffer.from([0]), crypto.sign("sha256", tbs, privateKey)])),
    );
    const cert =
      "-----BEGIN CERTIFICATE-----\n" +
      der
        .toString("base64")
        .match(/.{1,64}/g)!
        .join("\n") +
      "\n-----END CERTIFICATE-----\n";
    const key = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    return { cert, key, x509: new crypto.X509Certificate(cert) };
  }

  function csi(x509: crypto.X509Certificate, host: string) {
    return tls.checkServerIdentity(host, x509.toLegacyObject()) === undefined;
  }
  function checkHost(x509: crypto.X509Certificate, host: string, opts?: object) {
    return x509.checkHost(host, opts);
  }
  async function fetchOk(material: { cert: string; key: string }, host: string) {
    await using s = Bun.serve({ port: 0, tls: material, fetch: () => new Response("ok") });
    try {
      const r = await fetch(`https://127.0.0.1:${s.port}/`, {
        // @ts-expect-error Bun extension
        tls: { ca: material.cert, serverName: host },
        keepalive: false,
      });
      await r.text();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, code: e.code };
    }
  }

  // Wildcard-SAN certificate shared by the csi==fetch rows.
  const wild = makeCert("cn-not-in-san.test", [
    ["dns", "*.wild.test"],
    ["dns", "f*.partial.test"],
    ["dns", "*b.partial2.test"],
    ["dns", "w*w.mid.test"],
    ["dns", "exact.test"],
  ]);

  // tls.checkServerIdentity and fetch() share Node's lib/tls.js check()
  // semantics: partial wildcards anywhere in the left-most label, trailing dot
  // stripped, at least three labels, IDNA A-labels literal. The checkHost
  // column is recorded alongside for documentation; where Node's own checkHost
  // disagrees with checkServerIdentity (mid-label wildcard, trailing dot) the
  // expected value follows Node's checkHost.
  const csiRows: Array<[host: string, csi: boolean, checkHost: string | undefined]> = [
    ["foo.wild.test", true, "*.wild.test"],
    ["FOO.WILD.TEST", true, "*.wild.test"],
    ["foo.wild.test.", true, undefined],
    ["a.b.wild.test", false, undefined],
    ["wild.test", false, undefined],
    ["exact.test", true, "exact.test"],
    ["foo.partial.test", true, "f*.partial.test"],
    ["f.partial.test", true, "f*.partial.test"],
    ["bar.partial.test", false, undefined],
    ["foo.bar.partial.test", false, undefined],
    ["foob.partial2.test", true, "*b.partial2.test"],
    ["b.partial2.test", true, "*b.partial2.test"],
    ["fooc.partial2.test", false, undefined],
    ["wow.mid.test", true, undefined],
    ["ww.mid.test", true, undefined],
    ["abc.mid.test", false, undefined],
    ["cn-not-in-san.test", false, undefined],
    // UTS #46 maps U+3002, U+FF0E and U+FF61 to ".". Both matchers match a
    // non-ASCII host on its UTS #46 ASCII form (Node.js CVE-2026-48618, values
    // from v26.8.2). checkHost hands the raw host to OpenSSL, where "*" only
    // spans LDH bytes.
    ["foo\u3002bar.wild.test", false, undefined],
    ["foo\uff0ebar.wild.test", false, undefined],
    ["foo\uff61bar.wild.test", false, undefined],
    ["foo\u3002wild.test", true, undefined],
    ["exact\u3002test", true, undefined],
    ["exact.test\u3002", true, undefined],
    ["b\u00fccher.wild.test", true, undefined],
    ["\uff46oo.partial.test", true, undefined],
    // Node's check() lets "*" match the empty first label of ".wild.test", and
    // domainToASCII turns "\u3002wild.test" into that host. Both Bun matchers
    // reject an empty label. checkHost reads a leading "." as OpenSSL's
    // subdomain form.
    [".wild.test", false, "*.wild.test"],
    ["\u3002wild.test", false, undefined],
    // That ASCII form is the UTS #46 mapping alone, not url.domainToASCII(): a
    // URL host parse cuts the host at "/", "?", "#" and "\", drops tab, CR and
    // LF, and decodes "%xx". Each host below would then match "exact.test" or
    // "*.wild.test". An ASCII host is matched as typed.
    ["exact.test/.wild.test", false, undefined],
    ["exact.test?.wild.test", false, undefined],
    ["exact.test#.wild.test", false, undefined],
    ["exact.test\\.wild.test", false, undefined],
    ["exact.test\r\n", false, undefined],
    ["exact.\ttest", false, undefined],
    ["e%78act.test", false, undefined],
    ["foo.wild.test/x.evil.test", false, undefined],
    ["foo%2ewild.test", false, undefined],
    // The same hosts with one non-ASCII code point, so that both matchers map
    // them: U+FF45 maps to "e", U+FF46 to "f".
    ["\uff45xact.test/.wild.test", false, undefined],
    ["\uff45xact.test?.wild.test", false, undefined],
    ["\uff45xact.test#.wild.test", false, undefined],
    ["\uff45xact.test\\.wild.test", false, undefined],
    ["\uff45xact.test\r\n", false, undefined],
    ["\uff45%78act.test", false, undefined],
    ["\uff46oo.wild.test/x.evil.test", false, undefined],
    ["\uff46oo%2ewild.test", false, undefined],
    // An ASCII host that is not a valid URL host is still one label under "*".
    ["a b.wild.test", true, undefined],
    ["user@foo.wild.test", true, undefined],
    ["xn--a.wild.test", true, "*.wild.test"],
  ];

  describe.concurrent("checkServerIdentity == fetch", () => {
    it.each(csiRows)("%j", async (host, match, checkHostResult) => {
      expect({
        csi: csi(wild.x509, host),
        checkHost: checkHost(wild.x509, host),
        fetch: await fetchOk(wild, host),
      }).toEqual({
        csi: match,
        checkHost: checkHostResult,
        fetch: match ? { ok: true } : { ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      });
    });
  });

  // tls.checkServerIdentity matches a non-ASCII host on its UTS #46 ASCII form
  // and reports the host as typed. An ASCII host and an IP host get no mapping.
  describe("checkServerIdentity maps a non-ASCII host with UTS #46", () => {
    const wildcardSan = { subjectaltname: "DNS:*.example.com", subject: {} };
    const evilSan = { subjectaltname: "DNS:evil.test", subject: {} };
    const notInAltnames = (host: string, altnames = "DNS:*.example.com") =>
      `Host: ${host}. is not in the cert's altnames: ${altnames}`;
    const expectReason = (host: string, cert: object, reason: string | undefined) => {
      const err = tls.checkServerIdentity(host, cert as tls.PeerCertificate) as any;
      expect(err === undefined ? undefined : { code: err.code, reason: err.reason, host: err.host }).toEqual(
        reason === undefined ? undefined : { code: "ERR_TLS_CERT_ALTNAME_INVALID", reason, host },
      );
    };

    // Every expected value was taken from Node.js v26.8.2, except the two hosts
    // with an empty first label: Node lets "*" match it, Bun does not.
    it.each([
      ["foo\u3002bar.example.com", wildcardSan, notInAltnames("foo\u3002bar.example.com")],
      ["foo\uff0ebar.example.com", wildcardSan, notInAltnames("foo\uff0ebar.example.com")],
      ["foo\uff61bar.example.com", wildcardSan, notInAltnames("foo\uff61bar.example.com")],
      [".example.com", wildcardSan, notInAltnames(".example.com")],
      ["\u3002example.com", wildcardSan, notInAltnames("\u3002example.com")],
      [
        "foo\u3002bar.example.com",
        { subject: { CN: "*.example.com" } },
        "Host: foo\u3002bar.example.com. is not cert's CN: *.example.com",
      ],
      ["foo\u3002bar.example.com", { subjectaltname: "DNS:*.bar.example.com", subject: {} }, undefined],
      ["foo\u3002bar.example.com\u3002", { subjectaltname: "DNS:foo.bar.example.com", subject: {} }, undefined],
      ["b\u00fccher.example.com", { subjectaltname: "DNS:xn--bcher-kva.example.com", subject: {} }, undefined],
      ["::1", { subjectaltname: "IP Address:0:0:0:0:0:0:0:1", subject: {} }, undefined],
    ])("%j vs %j", expectReason);

    // The mapping is UTS #46 alone, not url.domainToASCII(). A URL host parse
    // cuts the host at "/", "?", "#" and "\", drops tab, CR and LF, and decodes
    // "%xx", so "evil.test/.example.com" would pass for the certificate of
    // evil.test. U+FF45 maps to "e" and U+FF46 to "f". Every expected value is
    // the one Node.js v26.3.0 gives, which matches each host as typed.
    it.each([
      ["evil.test/.example.com", evilSan, notInAltnames("evil.test/.example.com", "DNS:evil.test")],
      ["evil.test?.example.com", evilSan, notInAltnames("evil.test?.example.com", "DNS:evil.test")],
      ["evil.test#.example.com", evilSan, notInAltnames("evil.test#.example.com", "DNS:evil.test")],
      ["evil.test\\.example.com", evilSan, notInAltnames("evil.test\\.example.com", "DNS:evil.test")],
      ["evil.test\r\n", evilSan, notInAltnames("evil.test\r\n", "DNS:evil.test")],
      ["e%76il.test", evilSan, notInAltnames("e%76il.test", "DNS:evil.test")],
      ["foo.example.com/x.evil.test", wildcardSan, notInAltnames("foo.example.com/x.evil.test")],
      ["foo%2eexample.com", wildcardSan, notInAltnames("foo%2eexample.com")],
      [
        "evil.test/.example.com",
        { subject: { CN: "evil.test" } },
        "Host: evil.test/.example.com. is not cert's CN: evil.test",
      ],
      ["\uff45vil.test/.example.com", evilSan, notInAltnames("\uff45vil.test/.example.com", "DNS:evil.test")],
      ["\uff45vil.test\r\n", evilSan, notInAltnames("\uff45vil.test\r\n", "DNS:evil.test")],
      ["\uff45%76il.test", evilSan, notInAltnames("\uff45%76il.test", "DNS:evil.test")],
      ["\uff46oo.example.com/x.evil.test", wildcardSan, notInAltnames("\uff46oo.example.com/x.evil.test")],
      ["\uff46oo%2eexample.com", wildcardSan, notInAltnames("\uff46oo%2eexample.com")],
      ["a b.example.com", wildcardSan, undefined],
      ["user@foo.example.com", wildcardSan, undefined],
      ["xn--a.example.com", wildcardSan, undefined],
      // A URL host with a numeric last label must parse as IPv4, so url.domainToASCII("db.1") is "".
      ["db.1", { subjectaltname: "DNS:db.1", subject: {} }, undefined],
    ])("%j vs %j", expectReason);

    // A host is an IP address only as typed. UTS #46 maps this one to
    // "127.0.0.1", and Node still matches it as a DNS name.
    it("a host that maps to an IPv4 literal does not match an IP SAN", async () => {
      const m = makeCert("x", [["ip", "127.0.0.1"]]);
      const host = "\uff11\uff12\uff17.0.0.1";
      expect({ csi: csi(m.x509, host), fetch: await fetchOk(m, host) }).toEqual({
        csi: false,
        fetch: { ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      });
    });
  });

  // tls.serverName is a C string in the native TLS configuration. SNI and the
  // native matcher would see "exact.test" for "exact.test\0.wild.test", so
  // fetch and Bun.connect refuse the option. node:tls does what Node.js does:
  // SNI ends at the NUL, and checkServerIdentity gets the whole name.
  describe.concurrent("a NUL in the server name", () => {
    const message = '"serverName" must not contain null bytes';
    async function expectRefused(open: () => Promise<() => void>) {
      let close: (() => void) | undefined;
      try {
        await expect((async () => void (close = await open()))()).rejects.toThrow(message);
      } finally {
        close?.();
      }
    }

    it.each(["exact.test\0.wild.test", "exact.test\0", "\uff45xact.test\0.wild.test"])("%j", async serverName => {
      await using server = Bun.serve({ port: 0, tls: wild, fetch: () => new Response("ok") });
      const tlsOptions = { ca: wild.cert, serverName };

      expect(csi(wild.x509, serverName)).toBe(false);
      await expectRefused(async () => {
        // @ts-expect-error Bun extension
        await (await fetch(`https://127.0.0.1:${server.port}/`, { tls: tlsOptions, keepalive: false })).text();
        return () => {};
      });
      await expectRefused(async () => {
        const socket = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          tls: tlsOptions,
          socket: { data() {} },
        });
        return () => socket.end();
      });
      for (const trust of [{ ca: wild.cert }, { secureContext: tls.createSecureContext({ ca: wild.cert }) }]) {
        const { promise, resolve } = Promise.withResolvers<unknown>();
        const socket = tls.connect({ host: "127.0.0.1", port: server.port, servername: serverName, ...trust });
        socket.on("secureConnect", () => resolve({ authorized: socket.authorized }));
        socket.on("error", resolve);
        try {
          expect(await promise).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID", host: serverName });
        } finally {
          socket.destroy();
        }
      }
    });
  });

  // Rejections Node's check() applies to the pattern that the native matcher
  // must not relax. The checkHost column is Node/OpenSSL's verdict; where that
  // falls through to equal_nocase (a..b.test) it matches even though Node's
  // lib/tls.js check() hard-rejects the same pattern.
  const rejectSans: Array<[san: string, host: string, checkHost: string | undefined]> = [
    ["f**.partial.test", "foo.partial.test", undefined],
    ["*.test", "foo.test", undefined],
    ["xn--f*.partial.test", "xn--foo.partial.test", undefined],
    ["a..b.test", "a..b.test", "a..b.test"],
  ];
  describe.concurrent("pattern rejections", () => {
    it.each(rejectSans)("SAN %j must not match %j", async (san, host, checkHostResult) => {
      const m = makeCert("x", [["dns", san]]);
      expect({
        csi: csi(m.x509, host),
        checkHost: checkHost(m.x509, host),
        fetch: await fetchOk(m, host),
      }).toEqual({
        csi: false,
        checkHost: checkHostResult,
        fetch: { ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      });
    });
  });

  // CN fallback: Node's checkServerIdentity and OpenSSL's default checkHost
  // both fall back to the Subject CN when the certificate carries no dNSName
  // SAN; non-DNS SANs (email / IP / URI) must not suppress that.
  const cnRows: Array<[label: string, cn: string, sans: San[], host: string, csi: boolean, checkHost: boolean]> = [
    ["no SAN", "nosan.a.test", [], "nosan.a.test", true, true],
    ["email-only SAN", "emailcn.a.test", [["email", "a@x.test"]], "emailcn.a.test", true, true],
    ["IP-only SAN", "ipcn.a.test", [["ip", "10.0.0.1"]], "ipcn.a.test", true, true],
    ["URI-only SAN", "uricn.a.test", [["uri", "https://x.test/"]], "uricn.a.test", true, true],
    ["DNS SAN present", "dnscn.a.test", [["dns", "other.a.test"]], "dnscn.a.test", false, false],
  ];
  describe.concurrent("CN fallback", () => {
    it.each(cnRows)("%s -> %j", async (_label, cn, sans, host, csiMatch, checkHostMatch) => {
      const m = makeCert(cn, sans);
      expect({
        csi: csi(m.x509, host),
        checkHost: checkHost(m.x509, host) === cn,
        fetch: await fetchOk(m, host),
      }).toEqual({
        csi: csiMatch,
        checkHost: checkHostMatch,
        fetch: csiMatch ? { ok: true } : { ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      });
    });
  });

  // X509Certificate#checkHost options. Every expected value was taken from
  // Node.js v26.3.0 (OpenSSL X509_check_host semantics).
  describe("checkHost options", () => {
    const W = makeCert("cn.a.test", [
      ["dns", "*.wild.test"],
      ["dns", "exact.test"],
    ]);
    const P = makeCert("x", [["dns", "f*.partial.test"]]);
    const Sfx = makeCert("x", [["dns", "*foo.wild.test"]]);
    const Sub = makeCert("x", [["dns", "a.b.wild.test"]]);
    const NoSan = makeCert("nosan.a.test", []);
    const certs = { W, P, Sfx, Sub, NoSan };

    it.each([
      // [cert, host, opts, expected]
      ["W", "foo.wild.test", { wildcards: false }, undefined],
      ["W", "exact.test", { wildcards: false }, "exact.test"],
      ["P", "foo.partial.test", { partialWildcards: false }, undefined],
      ["P", "foo.partial.test", { partialWildcards: true }, "f*.partial.test"],
      ["W", "a.b.wild.test", { multiLabelWildcards: true }, "*.wild.test"],
      ["W", "a.b.wild.test", { multiLabelWildcards: false }, undefined],
      ["P", "foo.bar.partial.test", { multiLabelWildcards: true }, undefined],
      ["W", "cn.a.test", { subject: "always" }, "cn.a.test"],
      ["W", "cn.a.test", { subject: "default" }, undefined],
      ["W", "cn.a.test", { subject: "never" }, undefined],
      ["NoSan", "nosan.a.test", { subject: "never" }, undefined],
      ["Sub", ".wild.test", undefined, "a.b.wild.test"],
      ["Sub", ".wild.test", { singleLabelSubdomains: true }, undefined],
      ["Sub", ".b.wild.test", { singleLabelSubdomains: true }, "a.b.wild.test"],
      ["W", "foo.wild.test", {}, "*.wild.test"],
      // OpenSSL wildcard_match host-side checks: the span under `*` must be
      // LDH, and a partial wildcard never matches an IDNA host label.
      ["W", "foo-bar.wild.test", undefined, "*.wild.test"],
      ["W", "foo_bar.wild.test", undefined, undefined],
      ["P", "foo_bar.partial.test", undefined, undefined],
      ["W", "a_b.c.wild.test", { multiLabelWildcards: true }, undefined],
      ["W", "xn--foo.wild.test", undefined, "*.wild.test"],
      ["Sfx", "xn--foo.wild.test", undefined, undefined],
    ] as const)("%s checkHost(%j, %o) -> %j", (name, host, opts, expected) => {
      expect(checkHost(certs[name].x509, host, opts)).toBe(expected);
    });

    // OpenSSL valid_star pattern-side scan: every pattern label must be LDH
    // with no boundary hyphen, else the `*` is never expanded; a failed scan
    // falls through to equal_nocase rather than hard-rejecting. LABEL_IDNA is
    // only set when a label *starts* with xn-- (not Node's includes()).
    it.each([
      ["*_x.wild.test", "foo_x.wild.test", undefined],
      ["*.a_b.test", "foo.a_b.test", undefined],
      ["*-.wild.test", "foo-.wild.test", undefined],
      ["-*.wild.test", "-foo.wild.test", undefined],
      ["a-*.wild.test", "a-b.wild.test", undefined],
      ["*.-wild.test", "foo.-wild.test", undefined],
      ["*.wild-.test", "foo.wild-.test", undefined],
      ["*-b.wild.test", "a-b.wild.test", "*-b.wild.test"],
      ["a..b.test", "a..b.test", "a..b.test"],
      ["exact.test.", "exact.test.", "exact.test."],
      ["exact.test.", "exact.test", undefined],
      ["exact test.a.b", "exact test.a.b", "exact test.a.b"],
      ["axn--b*.c.d", "axn--bZ.c.d", "axn--b*.c.d"],
      ["xn--a*.c.d", "xn--aZ.c.d", undefined],
    ] as const)("SAN %j checkHost(%j) -> %j", (san, host, expected) => {
      expect(checkHost(makeCert("x", [["dns", san]]).x509, host)).toBe(expected);
    });

    // {wildcards: false} is also an OpenSSL-semantics mode (equal_nocase).
    it.each([
      ["a..b.test", "a..b.test", "a..b.test"],
      ["exact.test.", "exact.test.", "exact.test."],
    ] as const)("SAN %j checkHost(%j, {wildcards:false}) -> %j", (san, host, expected) => {
      expect(checkHost(makeCert("x", [["dns", san]]).x509, host, { wildcards: false })).toBe(expected);
    });

    // The dot-host suffix path rejects only on NUL, like OpenSSL equal_nocase.
    it("SAN 'a b.wild.test' checkHost('.wild.test') -> matched", () => {
      expect(checkHost(makeCert("x", [["dns", "a b.wild.test"]]).x509, ".wild.test")).toBe("a b.wild.test");
    });

    // CN fallback transcodes BMPString (UTF-16BE) via ASN1_STRING_to_UTF8 the
    // way OpenSSL do_check_string does.
    it("BMPString CN matches via CN fallback", () => {
      const bmp = Buffer.from("bmp.a.test", "utf16le").swap16();
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const subj = seq(set(seq(oid("550403"), tlv(0x1e, bmp))));
      const tbs = seq(
        tlv(0xa0, tlv(0x02, Buffer.from([2]))),
        tlv(0x02, Buffer.from([9])),
        ecdsaWithSha256,
        subj,
        seq(tlv(0x17, Buffer.from("240101000000Z")), tlv(0x17, Buffer.from("340101000000Z"))),
        subj,
        publicKey.export({ type: "spki", format: "der" }) as Buffer,
      );
      const der = seq(
        tbs,
        ecdsaWithSha256,
        tlv(0x03, Buffer.concat([Buffer.from([0]), crypto.sign("sha256", tbs, privateKey)])),
      );
      expect(new crypto.X509Certificate(der).checkHost("bmp.a.test")).toBe("bmp.a.test");
    });
  });
});
