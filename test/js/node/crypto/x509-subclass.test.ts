import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regression test for X509Certificate subclassing.
// Previously, subclassing used NodeVMScriptStructure() instead of the
// X509Certificate structure (copy-paste bug), causing subclass instances
// to inherit from vm.Script.prototype instead of X509Certificate.prototype.
// Also, X509Certificate.prototype was undefined because finishCreation()
// did not call putDirectWithoutTransition for the prototype property.

const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");
const certPath = path.join(keysDir, "agent1-cert.pem");
const certPem = readFileSync(certPath);
// ca1 issued agent1-cert and is itself self-signed.
const ca1Pem = readFileSync(path.join(keysDir, "ca1-cert.pem"));
// ca2 is an unrelated self-signed CA.
const ca2Pem = readFileSync(path.join(keysDir, "ca2-cert.pem"));

describe("X509Certificate", () => {
  test("constructor has .prototype property", () => {
    expect(X509Certificate.prototype).toBeDefined();
    expect(typeof X509Certificate.prototype).toBe("object");
  });

  test("prototype has expected methods", () => {
    expect(typeof X509Certificate.prototype.checkHost).toBe("function");
    expect(typeof X509Certificate.prototype.toJSON).toBe("function");
    expect(typeof X509Certificate.prototype.toString).toBe("function");
  });

  test("instance uses correct prototype", () => {
    const cert = new X509Certificate(certPem);
    expect(Object.getPrototypeOf(cert)).toBe(X509Certificate.prototype);
    expect(cert instanceof X509Certificate).toBe(true);
  });

  test("can be subclassed", () => {
    class MyX509 extends X509Certificate {
      customMethod() {
        return "custom";
      }
    }

    const cert = new MyX509(certPem);
    expect(cert instanceof MyX509).toBe(true);
    expect(cert instanceof X509Certificate).toBe(true);
    expect(cert.customMethod()).toBe("custom");
    // Should still have X509Certificate methods
    expect(typeof cert.subject).toBe("string");
  });

  test("subclass prototype chain is correct", () => {
    class MyX509 extends X509Certificate {}
    const cert = new MyX509(certPem);

    const proto = Object.getPrototypeOf(cert);
    expect(proto).toBe(MyX509.prototype);
    expect(Object.getPrototypeOf(proto)).toBe(X509Certificate.prototype);

    // Verify it's NOT inheriting from vm.Script (the previous bug)
    const vm = require("node:vm");
    expect(cert instanceof vm.Script).toBe(false);
    expect(Object.getPrototypeOf(proto)).not.toBe(vm.Script.prototype);
  });

  test("subclass instance accesses X509 getters correctly", () => {
    class MyX509 extends X509Certificate {}
    const cert = new MyX509(certPem);

    // These getters rely on the correct Structure to read internal fields
    expect(cert.subject).toBeDefined();
    expect(cert.issuer).toBeDefined();
    expect(cert.serialNumber).toBeDefined();
    expect(typeof cert.fingerprint).toBe("string");
  });

  test("serialNumber and modulus are uppercase hex (Node.js/OpenSSL compat)", () => {
    // BoringSSL's BN_bn2hex/BN_print emit lowercase hex; Node.js uses OpenSSL which
    // emits uppercase. Bun must normalize to uppercase so cert pinning by serial
    // string works the same as in Node.js.
    const cert = new X509Certificate(certPem);

    expect(cert.serialNumber).toBe("147D36C1C2F74206DE9FAB5F2226D78ADB00A426");
    expect(cert.serialNumber).toMatch(/^[0-9A-F]+$/);

    const legacy = cert.toLegacyObject();
    expect(legacy.serialNumber).toBe("147D36C1C2F74206DE9FAB5F2226D78ADB00A426");
    expect(legacy.modulus).toMatch(/^[0-9A-F]+$/);
    expect(legacy.modulus.startsWith("D456320AFB20D3827093DC2C4284ED04DFBABD56")).toBe(true);
  });
});

// checkIssued() must return a boolean to match Node.js. Previously Bun
// returned the issuer certificate object on success and undefined on failure.
// https://github.com/oven-sh/bun/issues/31570
describe("X509Certificate#checkIssued", () => {
  const agent1 = new X509Certificate(certPem);
  const ca1 = new X509Certificate(ca1Pem);
  const ca2 = new X509Certificate(ca2Pem);

  test("returns true when the certificate was issued by the other certificate", () => {
    const result = agent1.checkIssued(ca1);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  test("returns true for a self-signed certificate checked against itself", () => {
    const result = ca1.checkIssued(ca1);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  test("returns false for an unrelated issuer", () => {
    const result = agent1.checkIssued(ca2);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  test("returns false for a non-self-signed certificate checked against itself", () => {
    const result = agent1.checkIssued(agent1);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  test("throws ERR_INVALID_ARG_TYPE when the argument is not an X509Certificate", () => {
    expect(() => agent1.checkIssued({} as any)).toThrow();
    expect(() => agent1.checkIssued("" as any)).toThrow();
  });
});

// .ca is true only for certificates whose basicConstraints set CA:TRUE.
// https://github.com/oven-sh/bun/issues/31810
describe("X509Certificate#ca", () => {
  // Self-signed X.509 v1 certificate with no extensions (no basicConstraints).
  const v1NoExtensions = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIICAjCCAagCCQDFYI3zR8B/izAKBggqhkjOPQQDAjAPMQ0wCwYDVQQDDAR0ZXN0
MB4XDTI2MDUyODE3MDYwNVoXDTM2MDUyNTE3MDYwNVowDzENMAsGA1UEAwwEdGVz
dDCCAUswggEDBgcqhkjOPQIBMIH3AgEBMCwGByqGSM49AQECIQD/////AAAAAQAA
AAAAAAAAAAAAAP///////////////zBbBCD/////AAAAAQAAAAAAAAAAAAAAAP//
/////////////AQgWsY12Ko6k+ez671VdpiGvGUdBrDMU7D2O848PifSYEsDFQDE
nTYIhucEk2pmeOETnSa3gZ9+kARBBGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPSh
OUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfUCIQD/////AAAA
AP//////////vOb6racXnoTzucrC/GMlUQIBAQNCAAR1hd/nVei+or93b6B6lA0v
U52t80TD/E7NVfub7GJbHxbCX48zQH8YzMEsi/C/0G6N0/kf/ilwVuZXzwPVuTM/
MAoGCCqGSM49BAMCA0gAMEUCIFTzv2XBNlegDgPaDlhmcxwOx9FaIfy/9SF6+qmV
7IPSAiEAkQ1u46qvg4y2tr47yLzr0PbtPVYgjNS7VYLNDWf/btw=
-----END CERTIFICATE-----
`);

  // Self-signed X.509 v3 certificate with basicConstraints CA:TRUE.
  const v3CaTrue = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBjDCCATGgAwIBAgIUd0nA46zMcwqssVnVDNJ0F1APFuIwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwITXlSb290Q0EwHhcNMjYwNjA0MTYyMDM2WhcNMzYwNjAxMTYy
MDM2WjATMREwDwYDVQQDDAhNeVJvb3RDQTBZMBMGByqGSM49AgEGCCqGSM49AwEH
A0IABH5Mm74kubMd96Z5D09xITJcBhAiByKbnzyMRgcA14MlMmRXP9N812rhsyM6
drajhDSLmtoeaLfdf+0YnndMppWjYzBhMB0GA1UdDgQWBBT/fNxTnDHehlFQZpEt
DhbKDuhG+DAfBgNVHSMEGDAWgBT/fNxTnDHehlFQZpEtDhbKDuhG+DAPBgNVHRMB
Af8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNJADBGAiEAwON8
/nnAceDckQ0nD3etz11m120RFm0z3yGyPs2jmBQCIQCS7+FmRZYmXNAoqZFGtBmL
ALUH18cGAJfxlfxayzf4DA==
-----END CERTIFICATE-----
`);

  // X.509 v3 certificate with basicConstraints CA:FALSE.
  const v3CaFalse = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBkDCCATagAwIBAgIUG78W7gb1zr+WfA6NLqonnbC7C0YwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwITXlSb290Q0EwHhcNMjYwNjA0MTYyMDM2WhcNMjcwNjA0MTYy
MDM2WjAbMRkwFwYDVQQDDBBsZWFmLmV4YW1wbGUuY29tMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAE0Evk10/eXIG+PdR75ROVkXGsjygjbX+XtChIHDg9FNRdGQ01
DpqtLuJZ10EA3KfhqcIkC529yYvEpmYBobb+CqNgMF4wDAYDVR0TAQH/BAIwADAO
BgNVHQ8BAf8EBAMCB4AwHQYDVR0OBBYEFBPT7oz30YdjZ9Hykvt9MX87p7lBMB8G
A1UdIwQYMBaAFP983FOcMd6GUVBmkS0OFsoO6Eb4MAoGCCqGSM49BAMCA0gAMEUC
IQCMSgMdAzb2vAAqjc0c5ZSIbx+H6OyzIa47vJJAoL0aXAIgCLUr3IR6L/NJO5Vm
3yGsEHv16ABxoz4cPe2uxJ2BNsk=
-----END CERTIFICATE-----
`);

  test("is false for a v1 certificate with no basicConstraints", () => {
    expect(v1NoExtensions.ca).toBe(false);
    expect(v1NoExtensions.toLegacyObject().ca).toBe(false);
  });

  test("is true for a v3 certificate with basicConstraints CA:TRUE", () => {
    expect(v3CaTrue.ca).toBe(true);
    expect(v3CaTrue.toLegacyObject().ca).toBe(true);
  });

  test("is false for a v3 certificate with basicConstraints CA:FALSE", () => {
    expect(v3CaFalse.ca).toBe(false);
    expect(v3CaFalse.toLegacyObject().ca).toBe(false);
  });

  // Self-signed X.509 v3 certificate with basicConstraints CA:TRUE and no
  // keyUsage extension. Absent keyUsage allows all usages, so this is a CA.
  const v3CaTrueNoKeyUsage = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBeDCCAR+gAwIBAgIUHT2JuI0NIIyi6TVSMFnmvrkWn4gwCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHTm9LVS1DQTAeFw0yNjA5MDIwOTUzNTZaFw0zNjA4MzAwOTUz
NTZaMBIxEDAOBgNVBAMMB05vS1UtQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AAR7xWmKAtFVZyRs9FzWASJh7oJyVXMkl95YtB6O8l1fMUFAWdtmnMs5Zfnyce5H
69BGppFAfRacFynbTkIYr1soo1MwUTAdBgNVHQ4EFgQUjwEK42UtlVwNOTHr2Uxu
z6WhDQMwHwYDVR0jBBgwFoAUjwEK42UtlVwNOTHr2Uxuz6WhDQMwDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiAFadic93/x4K/rc/F3d8NKIHzXfKJv
rDfzgtk7kZ3sSAIgebdk3gZ/tzu0HcYN84YDIgmUNH3dFN/DL8sG1pWD94g=
-----END CERTIFICATE-----
`);

  // Self-signed X.509 v3 certificate with basicConstraints CA:TRUE but a
  // keyUsage extension that omits keyCertSign. Not a CA, matching Node.
  const v3CaTrueNoCertSign = new X509Certificate(`-----BEGIN CERTIFICATE-----
MIIBizCCATGgAwIBAgIUDbrkpWKP+EuGiDj88iIx2jmiWWAwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIQmFkS1UtQ0EwHhcNMjYwOTAyMDk1MzU2WhcNMzYwODMwMDk1
MzU2WjATMREwDwYDVQQDDAhCYWRLVS1DQTBZMBMGByqGSM49AgEGCCqGSM49AwEH
A0IABHvFaYoC0VVnJGz0XNYBImHugnJVcySX3li0Ho7yXV8xQUBZ22acyzll+fJx
7kfr0EamkUB9FpwXKdtOQhivWyijYzBhMB0GA1UdDgQWBBSPAQrjZS2VXA05MevZ
TG7PpaENAzAfBgNVHSMEGDAWgBSPAQrjZS2VXA05MevZTG7PpaENAzAPBgNVHRMB
Af8EBTADAQH/MA4GA1UdDwEB/wQEAwIHgDAKBggqhkjOPQQDAgNIADBFAiEA3Ol0
RcxWXw7xfL0LpSYylWfqVrkTE2JUWaiLMwKhiN8CIEK0D0bR3jd5uFG7QUYudOI9
FnsAZB/i9iiFjmi19obo
-----END CERTIFICATE-----
`);

  test("is true for a v3 CA:TRUE certificate with no keyUsage extension", () => {
    expect(v3CaTrueNoKeyUsage.ca).toBe(true);
    expect(v3CaTrueNoKeyUsage.toLegacyObject().ca).toBe(true);
  });

  test("is false for a v3 CA:TRUE certificate whose keyUsage omits keyCertSign", () => {
    expect(v3CaTrueNoCertSign.ca).toBe(false);
    expect(v3CaTrueNoCertSign.toLegacyObject().ca).toBe(false);
  });
});
