import { createTest } from "node-harness";
const { describe, expect } = createTest(import.meta.path);

describe("tls", () => {
  test("rootCertificates should be immutable", () => {
    const tls = require("tls");

    // Check that rootCertificates is defined and has expected properties
    expect(tls.rootCertificates).toBeDefined();
    expect(tls.rootCertificates).toBeInstanceOf(Array);
    expect(tls.rootCertificates.length).toBeGreaterThan(0);

    // Store original rootCertificates array length and first element
    const originalLength = tls.rootCertificates.length;
    const originalFirstCert = tls.rootCertificates[0];

    // Try to modify the array by pushing a new element
    const fakeNewCert = "-----BEGIN CERTIFICATE-----\nFAKE CERTIFICATE\n-----END CERTIFICATE-----";
    let didThrow = false;
    try {
      tls.rootCertificates.push(fakeNewCert);
    } catch (error: any) {
      // Expected behavior if the array is frozen
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatchInlineSnapshot(`"Attempted to assign to readonly property."`);
      didThrow = true;
    }
    expect(didThrow).toBe(true);

    // Verify length hasn't changed
    expect(tls.rootCertificates.length).toBe(originalLength);

    // Try to modify an existing element
    didThrow = false;
    try {
      tls.rootCertificates[0] = fakeNewCert;
    } catch (error: any) {
      // Expected behavior if the array is frozen
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatchInlineSnapshot(`"Attempted to assign to readonly property."`);
      didThrow = true;
    }
    expect(didThrow).toBe(true);

    // Verify first element hasn't changed
    expect(tls.rootCertificates[0]).toBe(originalFirstCert);

    // Try to replace the entire property
    didThrow = false;
    try {
      tls.rootCertificates = [fakeNewCert];
    } catch (error: any) {
      // Expected behavior if the property is non-configurable
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toMatchInlineSnapshot(`"Attempted to assign to readonly property."`);
      didThrow = true;
    }
    expect(didThrow).toBe(true);

    // Verify it's still the original array
    expect(tls.rootCertificates.length).toBe(originalLength);
    expect(tls.rootCertificates[0]).toBe(originalFirstCert);

    // Check if the array is actually frozen
    expect(Object.isFrozen(tls.rootCertificates)).toBe(true);
  });
});
