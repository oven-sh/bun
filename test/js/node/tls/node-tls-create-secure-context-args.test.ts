import { describe, expect, it } from "bun:test";
import * as tls from "node:tls";

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: 0 })).toThrow(
      "string, null, or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: true })).toThrow(
      "string, null, or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: {} })).toThrow(
      "string, null, or undefined",
    );
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0, privateKeyEngine: "valid" })).toThrow(
      "string, null, or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true, privateKeyEngine: "valid" })).toThrow(
      "string, null, or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {}, privateKeyEngine: "valid" })).toThrow(
      "string, null, or undefined",
    );
  });

  it("should throw with a valid privateKeyIdentifier but missing privateKeyEngine", () => {
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid" })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });

  it("should not throw for invalid privateKeyEngine when privateKeyIdentifier is not provided", () => {
    // Node.js does not throw an error in the case where only privateKeyEngine is provided, even if
    // the key is invalid. The checks for both keys are only done when privateKeyIdentifier is passed.
    // Verifiable with: `node -p 'tls.createSecureContext({ privateKeyEngine: 0 })'`

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: 0 })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: true })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: {} })).not.toThrow();
  });

  it("should throw for invalid privateKeyIdentifier", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0 })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {} })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });
});
