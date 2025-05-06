import { describe, expect, it } from "bun:test";
import * as tls from "node:tls";

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: 0 })).toThrow("string, null, or undefined");
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: true })).toThrow("string, null, or undefined");
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: {} })).toThrow("string, null, or undefined");
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0 })).toThrow("string, null, or undefined");
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true })).toThrow("string, null, or undefined");
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {} })).toThrow("string, null, or undefined");
  });
});
