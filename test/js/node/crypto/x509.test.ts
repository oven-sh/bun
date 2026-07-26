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

// BoringSSL stubs X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT / NO_PARTIAL_WILDCARDS /
// MULTI_LABEL_WILDCARDS / SINGLE_LABEL_SUBDOMAINS to 0, so Bun reimplements
// OpenSSL's matching. Every expected value below is what Node.js (OpenSSL)
// returns for the same call.
describe("X509Certificate.checkHost() / checkEmail() options", () => {
  // SAN DNS:*.w.x509.sysfuzz.test, DNS:*.xn--bcher-kva.x509.sysfuzz.test
  // Subject CN=wild-cn-unused.example
  const wild = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIIB9TCCAZugAwIBAgIUI8OJajUyVOgpGPBbGl3btMhxlxAwCgYIKoZIzj0EAwIw\nKDESMBAGA1UECgwJeDUwOSBmdXp6MRIwEAYDVQQDDAl4NTA5LXJvb3QwIBcNMjYw\nNzA3MTQxMzU3WhgPMjA1NjA1MTAxNDEzNTdaMDUxEjAQBgNVBAoMCXg1MDkgZnV6\nejEfMB0GA1UEAwwWd2lsZC1jbi11bnVzZWQuZXhhbXBsZTBZMBMGByqGSM49AgEG\nCCqGSM49AwEHA0IABBlU+mcugKOB4r63yxEalCTcBv6sWAtt4yBPA4juhdcMS3xE\n/knQlI4nFIlzYkjlgfjRoNhD57Rf2ySMMEsoLRWjgZMwgZAwQwYDVR0RBDwwOoIV\nKi53Lng1MDkuc3lzZnV6ei50ZXN0giEqLnhuLS1iY2hlci1rdmEueDUwOS5zeXNm\ndXp6LnRlc3QwCQYDVR0TBAIwADAdBgNVHQ4EFgQUFKDoj6+Nnk/0iwi7A4m8Ry6d\nDyowHwYDVR0jBBgwFoAUm3cySAhYnJP1t9FnbozDAGFJPkgwCgYIKoZIzj0EAwID\nSAAwRQIgDOGDthc38j/YOh1TuznY4z48FGbFDeLn9oBWlR0CEugCIQDTN5HgZ6lj\nt8+fWEo5zpDp0etOTkYjoyH3STyOrhaaHA==\n-----END CERTIFICATE-----",
  );
  // SAN DNS:a*.p.x509.sysfuzz.test, DNS:*b.p.x509.sysfuzz.test,
  //     DNS:x*y.p.x509.sysfuzz.test, DNS:*.*.d.x509.sysfuzz.test,
  //     DNS:x.*.q.x509.sysfuzz.test, DNS:*.x509.sysfuzz.test, DNS:*
  // Subject CN=*.cn.x509.sysfuzz.test
  const partial = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIICUTCCAfegAwIBAgIUI8OJajUyVOgpGPBbGl3btMhxlxEwCgYIKoZIzj0EAwIw\nKDESMBAGA1UECgwJeDUwOSBmdXp6MRIwEAYDVQQDDAl4NTA5LXJvb3QwIBcNMjYw\nNzA3MTQxMzU3WhgPMjA1NjA1MTAxNDEzNTdaMDUxEjAQBgNVBAoMCXg1MDkgZnV6\nejEfMB0GA1UEAwwWKi5jbi54NTA5LnN5c2Z1enoudGVzdDBZMBMGByqGSM49AgEG\nCCqGSM49AwEHA0IABOnuFeF++N+Qy8NxJAUGnOAloNR/LX3f0I5ecGaoYJ42FMTg\n+8QjW4XzomIcIbR0XWJlhY7nLzOUCqA39keMtDSjge8wgewwgZ4GA1UdEQSBljCB\nk4IWYSoucC54NTA5LnN5c2Z1enoudGVzdIIWKmIucC54NTA5LnN5c2Z1enoudGVz\ndIIXeCp5LnAueDUwOS5zeXNmdXp6LnRlc3SCFyouKi5kLng1MDkuc3lzZnV6ei50\nZXN0ghd4LioucS54NTA5LnN5c2Z1enoudGVzdIITKi54NTA5LnN5c2Z1enoudGVz\ndIIBKjAJBgNVHRMEAjAAMB0GA1UdDgQWBBRbmxKfWC2X1A4DK5R1vggulknvozAf\nBgNVHSMEGDAWgBSbdzJICFick/W30WdujMMAYUk+SDAKBggqhkjOPQQDAgNIADBF\nAiEAvi2R0+115bGx19tn4WE//otIYAvwABsYCl2m3c3kbbgCIHSFczf0ONTAStTB\n19xWrPEssLALT86xmJZ3N7ePIrH3\n-----END CERTIFICATE-----",
  );
  // SAN email:san.first@x509.sysfuzz.test, email:UPPER@CASE.x509.sysfuzz.test,
  //     DNS:email.x509.sysfuzz.test
  // Subject CN=email.x509.sysfuzz.test, emailAddress=Subject.Mail@x509.sysfuzz.test
  const email = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIICUzCCAfqgAwIBAgIUI8OJajUyVOgpGPBbGl3btMhxlxIwCgYIKoZIzj0EAwIw\nKDESMBAGA1UECgwJeDUwOSBmdXp6MRIwEAYDVQQDDAl4NTA5LXJvb3QwIBcNMjYw\nNzA3MTQxMzU3WhgPMjA1NjA1MTAxNDEzNTdaMGUxEjAQBgNVBAoMCXg1MDkgZnV6\nejEgMB4GA1UEAwwXZW1haWwueDUwOS5zeXNmdXp6LnRlc3QxLTArBgkqhkiG9w0B\nCQEWHlN1YmplY3QuTWFpbEB4NTA5LnN5c2Z1enoudGVzdDBZMBMGByqGSM49AgEG\nCCqGSM49AwEHA0IABGkEy0ruQIsxpaobHzdCFlqb58Rho+OMDDGx9PEZBeFCVo+E\n3ctQ49W12DWNFcVdfHzojZ5ygLITNEJYlknUFAujgcIwgb8wXQYDVR0RBFYwVIEb\nc2FuLmZpcnN0QHg1MDkuc3lzZnV6ei50ZXN0gRxVUFBFUkBDQVNFLng1MDkuc3lz\nZnV6ei50ZXN0ghdlbWFpbC54NTA5LnN5c2Z1enoudGVzdDAJBgNVHRMEAjAAMBMG\nA1UdJQQMMAoGCCsGAQUFBwMEMB0GA1UdDgQWBBQaItMJT9+3JxiJken8yoPXhoM3\nSjAfBgNVHSMEGDAWgBSbdzJICFick/W30WdujMMAYUk+SDAKBggqhkjOPQQDAgNH\nADBEAiAONNhX7HU5PI2PAuJknyl/6dPGNZ1LPepWJcTxmuHUDwIgTZXdaT2f6dns\n65C/F6daxWrpj3rMBCGdsxj0EiH7emQ=\n-----END CERTIFICATE-----",
  );

  test("subject: 'always' checks the subject CN even when a DNS SAN is present", () => {
    expect(wild.checkHost("wild-cn-unused.example", { subject: "always" })).toBe("wild-cn-unused.example");
    expect(wild.checkHost("wild-cn-unused.example", { subject: "default" })).toBeUndefined();
    expect(wild.checkHost("wild-cn-unused.example")).toBeUndefined();
    // Wildcard CN entries match too.
    expect(partial.checkHost("foo.cn.x509.sysfuzz.test", { subject: "always" })).toBe("*.cn.x509.sysfuzz.test");
    expect(partial.checkHost("foo.cn.x509.sysfuzz.test")).toBeUndefined();
  });

  test("partialWildcards defaults to true and matches 'a*.' / '*b.' SAN patterns", () => {
    expect(partial.checkHost("abc.p.x509.sysfuzz.test")).toBe("a*.p.x509.sysfuzz.test");
    expect(partial.checkHost("a.p.x509.sysfuzz.test")).toBe("a*.p.x509.sysfuzz.test");
    expect(partial.checkHost("xb.p.x509.sysfuzz.test", { partialWildcards: true })).toBe("*b.p.x509.sysfuzz.test");
    expect(partial.checkHost("b.p.x509.sysfuzz.test")).toBe("*b.p.x509.sysfuzz.test");
    // 'x*y' (star neither at start nor end of the label) never matches.
    expect(partial.checkHost("xZZy.p.x509.sysfuzz.test")).toBeUndefined();
    expect(partial.checkHost("xZZy.p.x509.sysfuzz.test", { partialWildcards: true })).toBeUndefined();
  });

  test("partialWildcards: false restricts '*' to a full label", () => {
    expect(partial.checkHost("abc.p.x509.sysfuzz.test", { partialWildcards: false })).toBeUndefined();
    expect(partial.checkHost("xb.p.x509.sysfuzz.test", { partialWildcards: false })).toBeUndefined();
    // Full-label wildcards still work.
    expect(partial.checkHost("p.x509.sysfuzz.test", { partialWildcards: false })).toBe("*.x509.sysfuzz.test");
  });

  test("multiLabelWildcards: true lets a full-label '*' span multiple labels", () => {
    expect(wild.checkHost("a.b.w.x509.sysfuzz.test", { multiLabelWildcards: true })).toBe("*.w.x509.sysfuzz.test");
    expect(wild.checkHost("a.b.c.w.x509.sysfuzz.test", { multiLabelWildcards: true })).toBe("*.w.x509.sysfuzz.test");
    expect(wild.checkHost("a.b.w.x509.sysfuzz.test")).toBeUndefined();
    expect(wild.checkHost("a.b.w.x509.sysfuzz.test", { multiLabelWildcards: false })).toBeUndefined();
    // Only applies to full-label '*.' patterns: 'a*.' cannot span labels, so
    // 'a.b.p...' falls through to '*.x509.sysfuzz.test'.
    expect(partial.checkHost("a.b.p.x509.sysfuzz.test", { multiLabelWildcards: true })).toBe("*.x509.sysfuzz.test");
  });

  test("singleLabelSubdomains limits how far '.suffix' inputs can reach", () => {
    // Input starting with '.' matches any SAN that ends in that suffix.
    expect(partial.checkHost(".x509.sysfuzz.test")).toBe("a*.p.x509.sysfuzz.test");
    expect(partial.checkHost(".sysfuzz.test")).toBe("a*.p.x509.sysfuzz.test");
    // With singleLabelSubdomains the SAN may only have one extra label.
    expect(partial.checkHost(".sysfuzz.test", { singleLabelSubdomains: true })).toBeUndefined();
    expect(partial.checkHost("foo.x509.sysfuzz.test", { singleLabelSubdomains: true })).toBe("*.x509.sysfuzz.test");
  });

  test("patterns with a wildcard outside the first label are never valid", () => {
    expect(partial.checkHost("a.b.d.x509.sysfuzz.test")).toBeUndefined();
    expect(partial.checkHost("x.a.q.x509.sysfuzz.test")).toBeUndefined();
    expect(partial.checkHost("anything")).toBeUndefined();
  });

  test("checkEmail subject: 'always' checks the subject emailAddress", () => {
    expect(email.checkEmail("Subject.Mail@x509.sysfuzz.test", { subject: "always" })).toBe(
      "Subject.Mail@x509.sysfuzz.test",
    );
    expect(email.checkEmail("Subject.Mail@x509.sysfuzz.test")).toBeUndefined();
    expect(email.checkEmail("Subject.Mail@x509.sysfuzz.test", { subject: "never" })).toBeUndefined();
    // SAN email entries always match; local-part is case-sensitive, domain is not.
    expect(email.checkEmail("san.first@x509.sysfuzz.test")).toBe("san.first@x509.sysfuzz.test");
    expect(email.checkEmail("UPPER@CASE.x509.sysfuzz.test")).toBe("UPPER@CASE.x509.sysfuzz.test");
    expect(email.checkEmail("upper@case.x509.sysfuzz.test")).toBeUndefined();
  });

  test("an empty options object is accepted", () => {
    expect(wild.checkHost("foo.w.x509.sysfuzz.test", {})).toBe("*.w.x509.sysfuzz.test");
    expect(email.checkEmail("san.first@x509.sysfuzz.test", {})).toBe("san.first@x509.sysfuzz.test");
  });

  test("embedded NUL in the name is rejected", () => {
    expect(() => wild.checkHost("agent\x001")).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    expect(() => email.checkEmail("not\x00hing")).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  });
});

// OpenSSL's default subject-fallback rule checks the subject CN/emailAddress
// whenever the certificate has no SAN of the *relevant* type. BoringSSL's
// X509_check_host/X509_check_email skip the subject as soon as the SAN
// extension is present at all. Every expected value below is what Node.js
// (OpenSSL) returns for the same call.
describe("X509Certificate.checkHost() / checkEmail() default subject fallback", () => {
  // Subject CN=host.a.test, emailAddress=subj@a.test
  // subjectAltName: email:san@a.test (no DNS entry)
  const emailOnlySan = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIIBbDCCARKgAwIBAgIBBTAKBggqhkjOPQQDAjAyMRowGAYJKoZIhvcNAQkBFgtz\ndWJqQGEudGVzdDEUMBIGA1UEAwwLaG9zdC5hLnRlc3QwHhcNMjQwMTAxMDAwMDAw\nWhcNMzQwMTAxMDAwMDAwWjAyMRowGAYJKoZIhvcNAQkBFgtzdWJqQGEudGVzdDEU\nMBIGA1UEAwwLaG9zdC5hLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATA\n8oSTaHTNhZd7xBzP0wK4G63rTE3n+3VgLWtJ094xIurJGsb/Szp1zwlWvs1UqMkD\ns4ggDNQIOV4F/C6H7w+aoxkwFzAVBgNVHREEDjAMgQpzYW5AYS50ZXN0MAoGCCqG\nSM49BAMCA0gAMEUCIQDaDemParcnR+082ph2x+2WLqnX2pE/ekPTaH1ZNcs+9QIg\nNucFI8ZLT94vxoI+iChvM1epdnyPMj0GHxnj9eUgYX0=\n-----END CERTIFICATE-----",
  );
  // Subject CN=host.b.test, emailAddress=hidden@b.test
  // subjectAltName: DNS:host.b.test (no email entry)
  const dnsOnlySan = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIIBcTCCARegAwIBAgIBBTAKBggqhkjOPQQDAjA0MRwwGgYJKoZIhvcNAQkBFg1o\naWRkZW5AYi50ZXN0MRQwEgYDVQQDDAtob3N0LmIudGVzdDAeFw0yNDAxMDEwMDAw\nMDBaFw0zNDAxMDEwMDAwMDBaMDQxHDAaBgkqhkiG9w0BCQEWDWhpZGRlbkBiLnRl\nc3QxFDASBgNVBAMMC2hvc3QuYi50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcD\nQgAEwPKEk2h0zYWXe8Qcz9MCuBut60xN5/t1YC1rSdPeMSLqyRrG/0s6dc8JVr7N\nVKjJA7OIIAzUCDleBfwuh+8PmqMaMBgwFgYDVR0RBA8wDYILaG9zdC5iLnRlc3Qw\nCgYIKoZIzj0EAwIDSAAwRQIgLpQQaN9ewR4/libViPKpYMf4v1+3LAJzR91eoIdo\nXP8CIQCBAsQh2Co3UqUWhLzg6cMiB8UsMvJ1fXDUryyBQ6LmYA==\n-----END CERTIFICATE-----",
  );
  // Subject CN=host.c.test, emailAddress=subj@c.test
  // subjectAltName: present but an empty sequence
  const emptySan = new X509Certificate(
    "-----BEGIN CERTIFICATE-----\nMIIBYTCCAQagAwIBAgIBBTAKBggqhkjOPQQDAjAyMRowGAYJKoZIhvcNAQkBFgtz\ndWJqQGMudGVzdDEUMBIGA1UEAwwLaG9zdC5jLnRlc3QwHhcNMjQwMTAxMDAwMDAw\nWhcNMzQwMTAxMDAwMDAwWjAyMRowGAYJKoZIhvcNAQkBFgtzdWJqQGMudGVzdDEU\nMBIGA1UEAwwLaG9zdC5jLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATA\n8oSTaHTNhZd7xBzP0wK4G63rTE3n+3VgLWtJ094xIurJGsb/Szp1zwlWvs1UqMkD\ns4ggDNQIOV4F/C6H7w+aow0wCzAJBgNVHREEAjAAMAoGCCqGSM49BAMCA0kAMEYC\nIQDNDUdpjkPlDdHOC3GfMVsyqoW8EJQwpF12pGG7Jh3+ZQIhAKR1TAT1tz+qkaRL\nWBHSHNFMPBDhzbM67wHBVQYxoESB\n-----END CERTIFICATE-----",
  );

  test("checkHost falls back to the subject CN when the SAN has no DNS entries", () => {
    expect(emailOnlySan.checkHost("host.a.test")).toBe("host.a.test");
    expect(emailOnlySan.checkHost("host.a.test", { subject: "default" })).toBe("host.a.test");
    expect(emailOnlySan.checkHost("host.a.test", { subject: "never" })).toBeUndefined();
    // The SAN email entry is still honoured by checkEmail, and because there is
    // an email SAN the subject emailAddress is not consulted.
    expect(emailOnlySan.checkEmail("san@a.test")).toBe("san@a.test");
    expect(emailOnlySan.checkEmail("subj@a.test")).toBeUndefined();
  });

  test("checkEmail falls back to the subject emailAddress when the SAN has no email entries", () => {
    expect(dnsOnlySan.checkEmail("hidden@b.test")).toBe("hidden@b.test");
    expect(dnsOnlySan.checkEmail("hidden@b.test", { subject: "default" })).toBe("hidden@b.test");
    expect(dnsOnlySan.checkEmail("hidden@b.test", { subject: "never" })).toBeUndefined();
    // The SAN DNS entry is still honoured by checkHost.
    expect(dnsOnlySan.checkHost("host.b.test")).toBe("host.b.test");
  });

  test("an empty subjectAltName sequence still falls back to the subject", () => {
    expect(emptySan.checkHost("host.c.test")).toBe("host.c.test");
    expect(emptySan.checkEmail("subj@c.test")).toBe("subj@c.test");
    expect(emptySan.checkHost("host.c.test", { subject: "never" })).toBeUndefined();
    expect(emptySan.checkEmail("subj@c.test", { subject: "never" })).toBeUndefined();
  });
});
