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

// X509Certificate.prototype accessors must be non-enumerable, matching Node.js.
// Previously Bun marked them enumerable, so walking the prototype (e.g. Bluebird's
// promisifyAll) invoked the getters with the prototype as `this` and threw
// ERR_INVALID_THIS. https://github.com/oven-sh/bun/issues/31806
describe("X509Certificate.prototype accessor enumerability", () => {
  const accessors = [
    "ca",
    "fingerprint",
    "fingerprint256",
    "fingerprint512",
    "infoAccess",
    "issuer",
    "issuerCertificate",
    "keyUsage",
    "publicKey",
    "raw",
    "serialNumber",
    "subject",
    "subjectAltName",
    "validFrom",
    "validFromDate",
    "validTo",
    "validToDate",
  ];

  const methods = [
    "checkEmail",
    "checkHost",
    "checkIP",
    "checkIssued",
    "checkPrivateKey",
    "toJSON",
    "toLegacyObject",
    "toString",
    "verify",
  ];

  test("accessors are non-enumerable", () => {
    // Map each property to its enumerable flag, or "missing" when the property is
    // absent, so the assertion fails loudly if an accessor is dropped (rather than
    // silently passing on an undefined descriptor).
    const state = Object.fromEntries(
      accessors.map(name => {
        const desc = Object.getOwnPropertyDescriptor(X509Certificate.prototype, name);
        return [name, desc ? desc.enumerable : "missing"];
      }),
    );
    expect(state).toEqual(Object.fromEntries(accessors.map(name => [name, false])));
  });

  test("methods are non-enumerable", () => {
    const state = Object.fromEntries(
      methods.map(name => {
        const desc = Object.getOwnPropertyDescriptor(X509Certificate.prototype, name);
        return [name, desc ? desc.enumerable : "missing"];
      }),
    );
    expect(state).toEqual(Object.fromEntries(methods.map(name => [name, false])));
  });

  test("Object.keys(prototype) is empty, matching Node", () => {
    // Like a Node ES6 class, no own property of the prototype is enumerable.
    expect(Object.keys(X509Certificate.prototype)).toEqual([]);
  });

  test("walking the prototype does not invoke getters (no ERR_INVALID_THIS)", () => {
    // Mirrors Bluebird's promisifyAll: enumerate the prototype keys and read each value.
    // No own property is enumerable, so the loop body never runs and reading values
    // (which would invoke the accessor getters with the prototype as `this`) must not throw.
    const visited: string[] = [];
    expect(() => {
      for (const key in X509Certificate.prototype) {
        visited.push(key);
        void (X509Certificate.prototype as any)[key];
      }
    }).not.toThrow();
    expect(visited).toEqual([]);
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
