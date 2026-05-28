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

const certPath = path.join(import.meta.dir, "..", "test", "fixtures", "keys", "agent1-cert.pem");
const certPem = readFileSync(certPath);

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
