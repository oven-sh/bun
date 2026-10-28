import { describe, expect, test } from "bun:test";
import { X509Certificate, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rootCertificates } from "node:tls";

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

// Self-signed, CN=emptysan.test. The subjectAltName extension is present but holds an empty
// GeneralNames SEQUENCE, so the extension prints as the empty string.
const emptySanCertPem = `-----BEGIN CERTIFICATE-----
MIIBLDCB0qADAgECAgEJMAoGCCqGSM49BAMCMBgxFjAUBgNVBAMMDWVtcHR5c2Fu
LnRlc3QwHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjAYMRYwFAYDVQQD
DA1lbXB0eXNhbi50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERZd4TI3L
9hB6mAqrzlK/lZtnTN1HQRh8noNVV9rHms6RFBhYp/mSU2JrMPIEGB8DP4YEnoin
Og/IJjctZ/WG6qMNMAswCQYDVR0RBAIwADAKBggqhkjOPQQDAgNJADBGAiEAlvDe
VqtVe0NtY8U5uwa7lqNLtkqjXClGQl4fgCV4KloCIQCwni1CVvWLJa0cZm3BQtwH
lGNHf1nq+j8dNaMGmheHKQ==
-----END CERTIFICATE-----
`;

// Self-signed, brainpoolP256r1 key (a curve BoringSSL does not support, so publicKey cannot be decoded).
const brainpoolCertPem = `-----BEGIN CERTIFICATE-----
MIIBfTCCASSgAwIBAgIUbtq88KPedDaNbLVSO/txNjRWPicwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJYnJhaW5wb29sMB4XDTI2MDgyMzIwMDAyMVoXDTM2MDgyMDIw
MDAyMVowFDESMBAGA1UEAwwJYnJhaW5wb29sMFowFAYHKoZIzj0CAQYJKyQDAwII
AQEHA0IABG8tl/XkdDFsqeIkd03yEF82Ivy1xzmsN8/NekZJzuwDSLlCCIbX2k6z
JUoTfqdTxRL4ccrI4cXpqDxZPPaywMOjUzBRMB0GA1UdDgQWBBRpnrKAVW6DXXNk
BABmxqGZ3WvcPDAfBgNVHSMEGDAWgBRpnrKAVW6DXXNkBABmxqGZ3WvcPDAPBgNV
HRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIBssqQu642CLwl1dfD7WoD0D
qGl/+1Di3abpA8YZOtoyAiAiScaiKhxu48bWQXYW5ZoQNzAfBIwL4krTuLVAKYZc
Vg==
-----END CERTIFICATE-----`;

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

describe("X509Certificate.subjectAltName", () => {
  test("is the printed extension when present", () => {
    const cert = new X509Certificate(wildcardSanCertPem);
    expect(cert.subjectAltName).toBe("DNS:*.wildcard.example.com, DNS:exact.example.com");
  });

  test("is undefined when the extension is absent", () => {
    const cert = new X509Certificate(cnOnlyCertPem);
    expect(cert.subjectAltName).toBeUndefined();
    expect(cert.toLegacyObject().subjectaltname).toBeUndefined();
  });

  test("is the empty string when the extension holds an empty GeneralNames sequence", () => {
    const cert = new X509Certificate(emptySanCertPem);
    expect(cert.subjectAltName).toBe("");
    expect(cert.toLegacyObject().subjectaltname).toBe("");
  });
});

describe("X509Certificate getters that fail", () => {
  test("publicKey throws on every access when the key cannot be decoded (nothing stale is cached)", () => {
    const cert = new X509Certificate(brainpoolCertPem);
    expect(() => cert.publicKey).toThrow(expect.objectContaining({ code: "ERR_OSSL_X509_PUBLIC_KEY_DECODE_ERROR" }));
    expect(() => cert.publicKey).toThrow(expect.objectContaining({ code: "ERR_OSSL_X509_PUBLIC_KEY_DECODE_ERROR" }));
    // The rest of the certificate is still readable and cached.
    expect(cert.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(cert.fingerprint256).toBe(cert.fingerprint256);
    expect(cert.toLegacyObject().fingerprint256).toBe(cert.fingerprint256);
  });
});

describe("X509Certificate.prototype property descriptors", () => {
  // validFromDate/validToDate were registered as CustomAccessorOrValue instead of
  // CustomAccessor, so reading their descriptors asserted in debug builds.
  test("validFromDate and validToDate descriptors read like their siblings", () => {
    const proto = X509Certificate.prototype;
    for (const name of ["validFromDate", "validToDate", "validFrom", "validTo"] as const) {
      const desc = Object.getOwnPropertyDescriptor(proto, name)!;
      expect({ ...desc, get: typeof desc.get }).toEqual({
        get: "function",
        set: undefined,
        enumerable: true,
        configurable: true,
      });
    }

    const all = Object.getOwnPropertyDescriptors(proto);
    expect(typeof all.validFromDate.get).toBe("function");
    expect(typeof all.validToDate.get).toBe("function");
  });

  test("extracted validFromDate/validToDate getters work on an instance", () => {
    const cert = new X509Certificate(wildcardSanCertPem);
    const getFrom = Object.getOwnPropertyDescriptor(X509Certificate.prototype, "validFromDate")!.get!;
    const getTo = Object.getOwnPropertyDescriptor(X509Certificate.prototype, "validToDate")!.get!;
    expect(getFrom.call(cert)).toBeInstanceOf(Date);
    expect(getFrom.call(cert)).toEqual(cert.validFromDate);
    expect(getTo.call(cert)).toEqual(cert.validToDate);
  });
});

describe("X509Certificate with an empty subject/issuer DN", () => {
  // Self-signed, `openssl req -x509 -subj "/"`: both names are empty sequences.
  const emptyDN = `-----BEGIN CERTIFICATE-----
MIIBVjCB/aADAgECAhQuLsSmUr9yJhK85A6fr6KJxbEtYDAKBggqhkjOPQQDAjAA
MCAXDTI2MDgyMTA2NDgzOVoYDzIxMjYwNzI4MDY0ODM5WjAAMFkwEwYHKoZIzj0C
AQYIKoZIzj0DAQcDQgAEGcl07hz+Ga1M2lw9m8AcNiT3BtxyF0Yd4LNbAecfbGTy
frdyY7uFQMgDJFcSRpuGxCKVBtL1Ba4OvyyHzK5lAKNTMFEwHQYDVR0OBBYEFE8M
P5LabG8GsdSx97we9lwExHqZMB8GA1UdIwQYMBaAFE8MP5LabG8GsdSx97we9lwE
xHqZMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgVfqEVOsOI/6d
hkcWEa9g5HIqxKTzvSMRYn6eH6gefDYCIQCAl55J4qfVTELr1B5REAw5LFnQRBGN
vKS1+tUUY19gsw==
-----END CERTIFICATE-----`;

  test("subject/issuer are undefined and toLegacyObject() does not throw (matches Node)", () => {
    const cert = new X509Certificate(emptyDN);
    expect(cert.subject).toBeUndefined();
    expect(cert.issuer).toBeUndefined();
    const legacy = cert.toLegacyObject();
    expect(legacy.subject).toEqual({});
    expect(legacy.issuer).toEqual({});
    expect(cert.checkIssued(cert)).toBe(true);
  });
});

// Certificate, CRL and public-key PEM bodies are base64-coded by simdutf rather
// than BoringSSL's constant-time codec (private keys keep the latter). The bytes
// accepted and produced must match what EVP_DecodeUpdate/EVP_EncodeUpdate did.
describe("PEM base64 for public objects", () => {
  // 812 bytes: the base64 ends in one '=' and the last line is 60 columns.
  const der = new X509Certificate(wildcardSanCertPem).raw;
  const b64 = der.toString("base64");
  const pem64 = (label: string, buf: Buffer) =>
    `-----BEGIN ${label}-----\n` +
    buf
      .toString("base64")
      .replace(/(.{64})/g, "$1\n")
      .replace(/\n?$/, "\n") +
    `-----END ${label}-----\n`;
  const canonical = pem64("CERTIFICATE", der);

  test("X509Certificate#toString() is 64-column PEM with a terminated last line", () => {
    expect(der.length % 3).toBe(2);
    expect(canonical).toEndWith("=\n-----END CERTIFICATE-----\n");
    expect(new X509Certificate(wildcardSanCertPem).toString()).toBe(canonical);
    expect(new X509Certificate(der).toString()).toBe(canonical);
  });

  test("a body that is an exact multiple of 64 columns ends with exactly one newline", () => {
    const certs = rootCertificates.map(p => new X509Certificate(p));
    const exact = certs.find(c => c.raw.length % 48 === 0);
    expect(exact).toBeDefined();
    expect(exact!.toString()).toBe(pem64("CERTIFICATE", exact!.raw));
    // And every other residue too.
    for (const c of certs) expect(c.toString()).toBe(pem64("CERTIFICATE", c.raw));
  });

  test.each([
    ["CRLF line endings", canonical.replaceAll("\n", "\r\n")],
    ["no line breaks in the body", "-----BEGIN CERTIFICATE-----\n" + b64 + "\n-----END CERTIFICATE-----\n"],
    [
      "spaces and tabs inside the body",
      "-----BEGIN CERTIFICATE-----\n" + b64.replace(/(.{10})/g, "$1 \t") + "\n-----END CERTIFICATE-----\n",
    ],
    [
      "whitespace between data and padding",
      "-----BEGIN CERTIFICATE-----\n" + b64.replace(/=$/, "\n =") + "\n-----END CERTIFICATE-----\n",
    ],
  ])("decodes with %s", (_, pem) => {
    expect(new X509Certificate(pem).raw.equals(der)).toBe(true);
  });

  test.each([
    ["missing padding", "-----BEGIN CERTIFICATE-----\n" + b64.replace(/=$/, "") + "\n-----END CERTIFICATE-----\n"],
    ["excess padding", "-----BEGIN CERTIFICATE-----\n" + b64 + "=\n-----END CERTIFICATE-----\n"],
    ["an invalid character", canonical.replace(/^(.{40})./m, "$1*")],
    ["data after padding", "-----BEGIN CERTIFICATE-----\n" + b64 + "AAAA\n-----END CERTIFICATE-----\n"],
    ["an empty body", "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n"],
  ])("rejects a body with %s", (_, pem) => {
    expect(() => new X509Certificate(pem)).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_INVALID_STATE" }));
  });

  test("PUBLIC KEY PEM round-trips, and PRIVATE KEY PEM (constant-time path) is unaffected", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const spkiDer = publicKey.export({ type: "spki", format: "der" });
    const spkiPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(spkiPem).toBe(pem64("PUBLIC KEY", spkiDer));
    expect(createPublicKey(spkiPem).export({ type: "spki", format: "der" }).equals(spkiDer)).toBe(true);
    const pkcs8Der = privateKey.export({ type: "pkcs8", format: "der" });
    const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(pkcs8Pem).toBe(pem64("PRIVATE KEY", pkcs8Der));
    expect(createPrivateKey(pkcs8Pem).export({ type: "pkcs8", format: "der" }).equals(pkcs8Der)).toBe(true);
  });
});
