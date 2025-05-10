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

    options.ciphers = "TLS_not_a_cipher";
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
  });
});
