import { describe, expect, test } from "bun:test";
import * as tls from "node:tls";

const fixtures = require("../test/common/fixtures");

describe("TLS No Cipher Match Error code matches Node.js", () => {
  test("The error should have all the same properties as Node.js", () => {
    const options = {
      key: fixtures.readKey("agent2-key.pem"),
      cert: fixtures.readKey("agent2-cert.pem"),
      ciphers: "aes256-sha",
    };

    expect(() =>
      tls.createServer(options, () => {
        throw new Error("should not be called");
      }),
    ).toThrow({
      code: "ERR_SSL_NO_CIPHER_MATCH",
      message: "No cipher match",
      library: "SSL routines",
      reason: "no cipher match",
    });

    options.ciphers = "FOOBARBAZ";
    expect(() =>
      tls.createServer(options, () => {
        throw new Error("should not be called");
      }),
    ).toThrow({
      code: "ERR_SSL_NO_CIPHER_MATCH",
      message: "No cipher match",
      library: "SSL routines",
      reason: "no cipher match",
    });

    // BoringSSL does not allow overriding the TLS 1.3 cipher suites, so a
    // TLS_* name in `ciphers` is ignored rather than rejected — Node built
    // against BoringSSL accepts this configuration (see the
    // openssl_is_boringssl branch of
    // test/js/node/test/parallel/test-tls-set-ciphers-error.js).
    options.ciphers = "TLS_not_a_cipher";
    expect(() =>
      tls.createServer(options, () => {
        throw new Error("should not be called");
      }),
    ).not.toThrow();
  });
});
