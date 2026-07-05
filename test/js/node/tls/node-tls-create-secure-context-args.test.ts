import { describe, expect, it } from "bun:test";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: 0 })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: true })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: {} })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {}, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
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

describe("secureProtocol conflicts with minVersion/maxVersion", () => {
  // `secureProtocol` pins both version bounds, so accepting it next to a
  // minVersion/maxVersion would silently drop the version floor the caller
  // asked for. Node throws ERR_TLS_PROTOCOL_VERSION_CONFLICT instead.
  function callAndCleanUp(fn: () => unknown): any {
    let error: any;
    let result: any;
    try {
      result = fn();
    } catch (e) {
      error = e;
    }
    // Without the check these calls hand back a socket that connects at the
    // downgraded version: tear it down so a regression fails on the assertion.
    if (result && typeof result.on === "function") {
      result.on("error", () => {});
      result.destroy?.();
    }
    return error;
  }

  function expectConflict(fn: () => unknown, message: string) {
    const error = callAndCleanUp(fn);
    expect(error).toBeInstanceOf(TypeError);
    expect({ code: error?.code, message: error?.message }).toEqual({
      code: "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
      message,
    });
  }

  const minConflict = 'TLS protocol version "TLSv1.3" conflicts with secureProtocol "TLSv1_2_method"';
  const maxConflict = 'TLS protocol version "TLSv1.1" conflicts with secureProtocol "TLSv1_2_method"';

  it("tls.createSecureContext", () => {
    expectConflict(
      () => tls.createSecureContext({ secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
    expectConflict(
      () => tls.createSecureContext({ secureProtocol: "TLSv1_2_method", maxVersion: "TLSv1.1" }),
      maxConflict,
    );
  });

  it("tls.connect", () => {
    expectConflict(
      () => tls.connect({ host: "127.0.0.1", port: 1, secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
  });

  it("https.request", () => {
    expectConflict(
      () => https.request({ host: "127.0.0.1", port: 1, secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
  });

  it("new tls.TLSSocket", () => {
    expectConflict(
      () => new tls.TLSSocket(new net.Socket(), { secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
  });

  it("tls.createServer", () => {
    expectConflict(() => tls.createServer({ secureProtocol: "TLSv1_2_method", maxVersion: "TLSv1.1" }), maxConflict);
  });

  it("server.setSecureContext", () => {
    const server = tls.createServer({});
    expectConflict(
      () => server.setSecureContext({ secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
  });

  it("server.addContext", () => {
    const server = tls.createServer({});
    expectConflict(
      () => server.addContext("example.com", { secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
      minConflict,
    );
  });

  it("is checked before the secureProtocol method name and the version strings", () => {
    // An unknown method and an invalid version are both reported as the conflict.
    expectConflict(
      () => tls.createSecureContext({ secureProtocol: "hokey-pokey", minVersion: "TLSv1.3" }),
      'TLS protocol version "TLSv1.3" conflicts with secureProtocol "hokey-pokey"',
    );
    expectConflict(
      // @ts-expect-error invalid version
      () => tls.createSecureContext({ secureProtocol: "TLSv1_2_method", minVersion: "fhqwhgads" }),
      'TLS protocol version "fhqwhgads" conflicts with secureProtocol "TLSv1_2_method"',
    );
  });

  it("accepts the options on their own", () => {
    expect(() => tls.createSecureContext({ secureProtocol: "TLSv1_2_method" })).not.toThrow();
    expect(() => tls.createSecureContext({ minVersion: "TLSv1.3" })).not.toThrow();
    expect(() => tls.createSecureContext({ maxVersion: "TLSv1.2", minVersion: "TLSv1.2" })).not.toThrow();
    // null/undefined mean "not set", so they do not conflict.
    expect(() =>
      tls.createSecureContext({ secureProtocol: "TLSv1_2_method", minVersion: undefined, maxVersion: undefined }),
    ).not.toThrow();
    expect(() =>
      // @ts-expect-error node accepts an explicit null here
      tls.createSecureContext({ secureProtocol: "TLSv1_2_method", minVersion: null, maxVersion: null }),
    ).not.toThrow();
  });

  it("an explicit secureContext takes precedence over the conflicting options", () => {
    const error = callAndCleanUp(() =>
      tls.connect({
        host: "127.0.0.1",
        port: 1,
        secureProtocol: "TLSv1_2_method",
        minVersion: "TLSv1.3",
        secureContext: tls.createSecureContext({}),
      }),
    );
    expect(error).toBeUndefined();
  });
});
