import { describe, expect, it } from "bun:test";

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
});
