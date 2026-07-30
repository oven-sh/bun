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

describe("X509Certificate subjectAltName/infoAccess GeneralName rendering", () => {
  const escaping = path.join(import.meta.dir, "..", "test", "fixtures", "x509-escaping");
  const altCert = (i: number) => new X509Certificate(readFileSync(path.join(escaping, `alt-${i}-cert.pem`)));
  const infoCert = (i: number) => new X509Certificate(readFileSync(path.join(escaping, `info-${i}-cert.pem`)));

  // SAN containing a Microsoft UPN otherName (OID 1.3.6.1.4.1.311.20.2.3) alongside
  // an otherName with an unrecognised OID. Node renders the UPN value; the unknown
  // OID stays <unsupported>.
  const upnCertPem = `-----BEGIN CERTIFICATE-----
MIIE/jCCBKOgAwIBAgIUZnRcX//etu5qC/QAboNi6sr28JEwCgYIKoZIzj0EAwIw
NzESMBAGA1UECgwJeDUwOSBmdXp6MQ4wDAYDVQQLDAVpbnRlcjERMA8GA1UEAwwI
eDUwOS1pY2EwIBcNMjYwNzA3MTQxMzU3WhgPMjA1NjA1MTAxNDEzNTdaMIGcMQsw
CQYDVQQGEwJVUzEXMBUGA1UECAwOQ2EsIGxpZitvciBuaWExFzAVBgNVBAcMDlNh
biBGcmFuO2NvXHN0MRgwFgYDVQQKDA94NTA5IGZ1enosIEluYy4xDzANBgNVBAsM
BnVuaXQgQTEPMA0GA1UECwwGdW5pdCBCMR8wHQYDVQQDDBZsZWFmLng1MDkuc3lz
ZnV6ei50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMq0JETQojnNa5naE
h0omNA2Lw0xyCFhwmNpY72Ovg7jNyeSPFG76CEAwZwfMkuOUYvQjoXas8TOXCCzU
BwlzWKOCAyMwggMfMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgSwMD4GA1Ud
JQQ3MDUGCCsGAQUFBwMBBggrBgEFBQcDAgYIKwYBBQUHAwQGCCsGAQUFBwMIBgsr
BgEEAYaNHwcDATAdBgNVHQ4EFgQU3v/4cOhnMu5PCkw1xeuT16dGCD0wHwYDVR0j
BBgwFoAU3rjGCTihf9dxHN2t2GOE676f/NowggG0BgNVHREEggGrMIIBp4IWbGVh
Zi54NTA5LnN5c2Z1enoudGVzdIIXKi5hbHQueDUwOS5zeXNmdXp6LnRlc3SCH3hu
LS1iY2hlci1rdmEueDUwOS5zeXNmdXp6LnRlc3SCBnNpbmdsZYcEfwAAAYcEChQe
KIcQAAAAAAAAAAAAAAAAAAAAAYcQIAENuIWjAAAAAIouA3BzNIEWbGVhZkB4NTA5
LnN5c2Z1enoudGVzdIEcc2Vjb25kQGFsdC54NTA5LnN5c2Z1enoudGVzdIYiaHR0
cHM6Ly94NTA5LnN5c2Z1enoudGVzdC9wYXRoP3E9MYYnbGRhcDovL2RzLng1MDku
c3lzZnV6ei50ZXN0OjM4OS9kYz14NTA5iAkrBgEEAYaNHyqgJQYKKwYBBAGCNxQC
A6AXDBV1cG5AeDUwOS5zeXNmdXp6LnRlc3SgIAYJKwYBBAGGjR8FoBMMEWN1c3Rv
bS1vdGhlci1uYW1lpEQwQjELMAkGA1UEBhMCVVMxEDAOBgNVBAoMB2RpciBvcmcx
ITAfBgNVBAMMGGRpci1jbi54NTA5LnN5c2Z1enoudGVzdDBrBggrBgEFBQcBAQRf
MF0wKgYIKwYBBQUHMAGGHmh0dHA6Ly9vY3NwLng1MDkuc3lzZnV6ei50ZXN0LzAv
BggrBgEFBQcwAoYjaHR0cDovL2NhLng1MDkuc3lzZnV6ei50ZXN0L2ljYS5kZXIw
NgYDVR0fBC8wLTAroCmgJ4YlaHR0cDovL2NybC54NTA5LnN5c2Z1enoudGVzdC9y
b290LmNybDAiBgNVHSAEGzAZMA0GCysGAQQBho0fAQIDMAgGBmeBDAECATAKBggq
hkjOPQQDAgNJADBGAiEAwo0YOYGn/dGePEVGONfRAstkLEmoD7MCx9nC4VfJivgC
IQCsfIM9dwu37dJvDDswGG+tckzIv5nLd7qdrspvBrl0nQ==
-----END CERTIFICATE-----`;

  test("subjectAltName renders the Microsoft UPN otherName", () => {
    const san = new X509Certificate(upnCertPem).subjectAltName;
    expect(san).toBe(
      "DNS:leaf.x509.sysfuzz.test, " +
        "DNS:*.alt.x509.sysfuzz.test, " +
        "DNS:xn--bcher-kva.x509.sysfuzz.test, " +
        "DNS:single, " +
        "IP Address:127.0.0.1, " +
        "IP Address:10.20.30.40, " +
        "IP Address:0:0:0:0:0:0:0:1, " +
        "IP Address:2001:DB8:85A3:0:0:8A2E:370:7334, " +
        "email:leaf@x509.sysfuzz.test, " +
        "email:second@alt.x509.sysfuzz.test, " +
        "URI:https://x509.sysfuzz.test/path?q=1, " +
        "URI:ldap://ds.x509.sysfuzz.test:389/dc=x509, " +
        "Registered ID:1.3.6.1.4.1.99999.42, " +
        "othername:UPN:upn@x509.sysfuzz.test, " +
        "othername:<unsupported>, " +
        'DirName:"CN=dir-cn.x509.sysfuzz.test\\u002cO=dir org\\u002cC=US"',
    );
  });

  test.each([
    [10, "IP Address:<invalid length=5>"],
    [11, "IP Address:<invalid length=6>"],
    [24, "othername:XmppAddr:abc123"],
    [25, 'othername:"XmppAddr:abc123\\u002c DNS:good.example.com"'],
    [26, 'othername:"XmppAddr:good.example.com\\u0000abc123"'],
    [27, "othername:<unsupported>"],
    [28, "othername:SRVName:abc123"],
    [29, "othername:<unsupported>"],
    [30, 'othername:"SRVName:abc\\u0000def"'],
  ])("subjectAltName matches Node for alt-%i-cert.pem", (i, expected) => {
    expect(altCert(i).subjectAltName).toBe(expected);
  });

  test("infoAccess renders otherName entries", () => {
    expect(infoCert(3).infoAccess).toBe(
      "OCSP - othername:XmppAddr:good.example.com\n" +
        "OCSP - othername:<unsupported>\n" +
        "OCSP - othername:SRVName:abc123\n",
    );
    expect(infoCert(4).infoAccess).toBe('OCSP - othername:"XmppAddr:good.example.com\\u0000abc123"\n');
  });
});
