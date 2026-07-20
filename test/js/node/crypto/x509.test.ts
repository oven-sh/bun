import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
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
