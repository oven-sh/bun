import { describe, expect, test } from "bun:test";
import crypto, { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Self-signed, valid until 2126. Subject CN=wildcard-san.example.com,
// subjectAltName: DNS:*.wildcard.example.com, DNS:exact.example.com
const wildcardSanCertPem = `-----BEGIN CERTIFICATE-----
MIIDKDCCAhCgAwIBAgIBATANBgkqhkiG9w0BAQsFADAjMSEwHwYDVQQDDBh3aWxk
Y2FyZC1zYW4uZXhhbXBsZS5jb20wIBcNMjYwNzAzMDY1MDAxWhgPMjEyNjA2MDkw
NjUwMDFaMCMxITAfBgNVBAMMGHdpbGRjYXJkLXNhbi5leGFtcGxlLmNvbTCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMEOoI3qCSq9CdlwWhHFf8xdUbhC
jp0MCgmRKqJh0JppBPykV808jOZeyZpFvtE3wM68YwsrVSwqrZgrClEb0GzYIpFI
Mxo5YoCIOluU6EL7ll/z7WyJ0SyfnSRt5braMXP3UQXYWv5XwDBFu1gXX6oC6o0S
0SJZTo4qg0agS9g17f1TmyUYA4wNDmEPS2hN6p3J+2uEIZE4GqxLgkvv8ON4iC2m
3/8xB5qGnZA+IT3f0dWC4IcMSeXSiWGyuEA+6/Otn/Iz073bOXAFkhv9DwXZca0O
YI6ecmwAFDjH6hBgX3jjwZL6Os1AZ/w9vLlb7vxEvdg9YiDEi/Io8sInkzcCAwEA
AaNlMGMwDAYDVR0TAQH/BAIwADA0BgNVHREELTArghYqLndpbGRjYXJkLmV4YW1w
bGUuY29tghFleGFjdC5leGFtcGxlLmNvbTAdBgNVHQ4EFgQUXkMY5bxwAaEAOtb7
v8++jiYQvbswDQYJKoZIhvcNAQELBQADggEBAKTfuXjBbtAvFyk2+pdqMzcQJlDl
eu1N06IvkTip0/Z0CKeRstkrqqmcspeHss7l/bnWXT83wUsZ2OJAM2dAxG7IsOPU
fsGlO6BSvzzPfsA/sGpxNxWitXtQAjGRDSw12xQ+KAgG3Outyc2aPeEkzcVV2SBm
o5JV0Big7OjvV0VQhN/6lrqSSknx0ZC2nV8GtWwew/mQP+MsuHsrmNTirH+raXBl
fzCNBW+YrUHAgV7gxvsqtld5sp+AA6rO9SO4kOCeXwxnJhxIafI8D2tZqNUf04LW
xoF/4xgOUMNvA8O5H/sm5QwghflFqkpuvqdeYHLNzb0yWUvPvtTfYiA7+vo=
-----END CERTIFICATE-----
`;

// CN=agent1, no subjectAltName, so the subject is the only thing to match against.
const cnOnlyCertPem = readFileSync(path.join(import.meta.dir, "..", "test", "fixtures", "keys", "agent1-cert.pem"));

describe("X509Certificate.checkHost()", () => {
  const cert = new X509Certificate(wildcardSanCertPem);
  const cnOnly = new X509Certificate(cnOnlyCertPem);

  test.each([
    ["sub.wildcard.example.com", "*.wildcard.example.com"],
    ["SUB.WILDCARD.EXAMPLE.COM", "*.wildcard.example.com"],
    ["exact.example.com", "exact.example.com"],
    ["EXACT.EXAMPLE.COM", "exact.example.com"],
  ])("%p returns the subjectAltName entry that matched", (host, matched) => {
    expect(cert.checkHost(host)).toBe(matched);
  });

  test.each([
    "a.b.wildcard.example.com", // wildcards match a single label by default
    "wildcard.example.com", // "*." requires at least one label
    "wildcard-san.example.com", // the subject CN is skipped when a SAN is present
    "nomatch.example.org",
  ])("%p does not match", host => {
    expect(cert.checkHost(host)).toBeUndefined();
  });

  test("wildcards: false only disables the wildcard entry", () => {
    expect(cert.checkHost("sub.wildcard.example.com", { wildcards: false })).toBeUndefined();
    expect(cert.checkHost("exact.example.com", { wildcards: false })).toBe("exact.example.com");
  });

  test.each(["agent1", "AGENT1", "AgEnT1"])("%p falls back to the subject CN and returns it", host => {
    expect(cnOnly.checkHost(host)).toBe("agent1");
  });

  test("subject: 'never' disables the subject CN fallback", () => {
    expect(cnOnly.checkHost("agent1", { subject: "never" })).toBeUndefined();
    expect(cnOnly.checkHost("agent2")).toBeUndefined();
  });

  test("checkEmail and checkIP are unaffected", () => {
    expect(cnOnly.checkEmail("ry@tinyclouds.org")).toBe("ry@tinyclouds.org");
    expect(cnOnly.checkEmail("ry@TINYCLOUDS.ORG")).toBe("ry@TINYCLOUDS.ORG");
    expect(cnOnly.checkEmail("sally@example.com")).toBeUndefined();
    expect(cnOnly.checkIP("127.0.0.1")).toBeUndefined();
  });
});

describe("new X509Certificate() from DER", () => {
  // Build a self-signed EC certificate whose SAN extension contains a single
  // DNS name of `sanBytes` bytes, so the resulting DER can be sized precisely
  // above and below BoringSSL's 100 KiB d2i_X509_bio limit.
  function makeCert(sanBytes: number) {
    const tlv = (tag: number, body: Buffer) => {
      const n = body.length;
      // DER requires the shortest possible length encoding.
      const len =
        n < 0x80
          ? Buffer.from([n])
          : n < 0x100
            ? Buffer.from([0x81, n])
            : n < 0x10000
              ? Buffer.from([0x82, n >> 8, n & 255])
              : Buffer.from([0x83, n >> 16, (n >> 8) & 255, n & 255]);
      return Buffer.concat([Buffer.from([tag]), len, body]);
    };
    const seq = (body: Buffer) => tlv(0x30, body);
    const oid = (hex: string) => tlv(0x06, Buffer.from(hex, "hex"));

    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const name = seq(tlv(0x31, seq(Buffer.concat([oid("550403"), tlv(0x0c, Buffer.from("big.test"))]))));
    const alg = seq(oid("2a8648ce3d040302"));
    const san = seq(seq(Buffer.concat([oid("551d11"), tlv(0x04, seq(tlv(0x82, Buffer.alloc(sanBytes, "a"))))])));
    const tbs = seq(
      Buffer.concat([
        Buffer.from([0xa0, 3, 2, 1, 2]),
        tlv(0x02, Buffer.from([7])),
        alg,
        name,
        seq(Buffer.concat([tlv(0x17, Buffer.from("240101000000Z")), tlv(0x17, Buffer.from("340101000000Z"))])),
        name,
        publicKey.export({ type: "spki", format: "der" }),
        Buffer.concat([Buffer.from([0xa3]), tlv(0x30, san).subarray(1)]),
      ]),
    );
    const sig = crypto.sign("sha256", tbs, privateKey);
    const der = seq(Buffer.concat([tbs, alg, tlv(0x03, Buffer.concat([Buffer.from([0]), sig]))]));
    const pem =
      "-----BEGIN CERTIFICATE-----\n" +
      der
        .toString("base64")
        .match(/.{1,64}/g)!
        .join("\n") +
      "\n-----END CERTIFICATE-----\n";
    return { der, pem };
  }

  test("parses DER larger than 100 KiB", () => {
    const { der, pem } = makeCert(101 * 1024);
    expect(der.length).toBeGreaterThan(100 * 1024);

    const fromPem = new X509Certificate(pem);
    expect(fromPem.subject).toBe("CN=big.test");

    const fromDer = new X509Certificate(der);
    expect(fromDer.subject).toBe("CN=big.test");
    expect(fromDer.raw.equals(der)).toBe(true);

    // round-trip through .raw
    const roundTrip = new X509Certificate(fromPem.raw);
    expect(roundTrip.subject).toBe("CN=big.test");
  });

  test("parses DER as a Uint8Array view with a byte offset", () => {
    const { der } = makeCert(101 * 1024);
    const backing = new ArrayBuffer(der.length + 16);
    const view = new Uint8Array(backing, 8, der.length);
    view.set(der);

    const fromView = new X509Certificate(view);
    expect(fromView.subject).toBe("CN=big.test");
  });

  test("still parses small DER and rejects invalid input", () => {
    const { der } = makeCert(16);
    expect(der.length).toBeLessThan(100 * 1024);
    expect(new X509Certificate(der).subject).toBe("CN=big.test");

    expect(() => new X509Certificate(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]))).toThrow();
  });
});
