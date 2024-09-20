//#FILE: test-quic-internal-endpoint-options.js
//#SHA1: 089ba4358a2a9ed3c5463e59d205ee7854f26f30
//-----------------
// Flags: --expose-internals
"use strict";

const common = require("../common");
if (!common.hasQuic) common.skip("missing quic");

const { internalBinding } = require("internal/test/binding");
const quic = internalBinding("quic");

quic.setCallbacks({
  onEndpointClose() {},
  onSessionNew() {},
  onSessionClose() {},
  onSessionDatagram() {},
  onSessionDatagramStatus() {},
  onSessionHandshake() {},
  onSessionPathValidation() {},
  onSessionTicket() {},
  onSessionVersionNegotiation() {},
  onStreamCreated() {},
  onStreamBlocked() {},
  onStreamClose() {},
  onStreamReset() {},
  onStreamHeaders() {},
  onStreamTrailers() {},
});

test("Invalid Endpoint constructor arguments", () => {
  expect(() => new quic.Endpoint()).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );

  expect(() => new quic.Endpoint("a")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );

  expect(() => new quic.Endpoint(null)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );

  expect(() => new quic.Endpoint(false)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );
});

test("Default options work", () => {
  expect(() => new quic.Endpoint({})).not.toThrow();
});

const cases = [
  {
    key: "retryTokenExpiration",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "tokenExpiration",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "maxConnectionsPerHost",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "maxConnectionsTotal",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "maxStatelessResetsPerHost",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "addressLRUSize",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "maxRetries",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "maxPayloadSize",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "unacknowledgedPacketThreshold",
    valid: [1, 10, 100, 1000, 10000, 10000n],
    invalid: [-1, -1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "validateAddress",
    valid: [true, false, 0, 1, "a"],
    invalid: [],
  },
  {
    key: "disableStatelessReset",
    valid: [true, false, 0, 1, "a"],
    invalid: [],
  },
  {
    key: "ipv6Only",
    valid: [true, false, 0, 1, "a"],
    invalid: [],
  },
  {
    key: "cc",
    valid: [
      quic.CC_ALGO_RENO,
      quic.CC_ALGO_CUBIC,
      quic.CC_ALGO_BBR,
      quic.CC_ALGO_BBR2,
      quic.CC_ALGO_RENO_STR,
      quic.CC_ALGO_CUBIC_STR,
      quic.CC_ALGO_BBR_STR,
      quic.CC_ALGO_BBR2_STR,
    ],
    invalid: [-1, 4, 1n, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "udpReceiveBufferSize",
    valid: [0, 1, 2, 3, 4, 1000],
    invalid: [-1, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "udpSendBufferSize",
    valid: [0, 1, 2, 3, 4, 1000],
    invalid: [-1, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "udpTTL",
    valid: [0, 1, 2, 3, 4, 255],
    invalid: [-1, 256, "a", null, false, true, {}, [], () => {}],
  },
  {
    key: "resetTokenSecret",
    valid: [new Uint8Array(16), new Uint16Array(8), new Uint32Array(4)],
    invalid: ["a", null, false, true, {}, [], () => {}, new Uint8Array(15), new Uint8Array(17), new ArrayBuffer(16)],
  },
  {
    key: "tokenSecret",
    valid: [new Uint8Array(16), new Uint16Array(8), new Uint32Array(4)],
    invalid: ["a", null, false, true, {}, [], () => {}, new Uint8Array(15), new Uint8Array(17), new ArrayBuffer(16)],
  },
  {
    // Unknown options are ignored entirely for any value type
    key: "ignored",
    valid: ["a", null, false, true, {}, [], () => {}],
    invalid: [],
  },
];

for (const { key, valid, invalid } of cases) {
  describe(`Endpoint option: ${key}`, () => {
    test.each(valid)("valid value: %p", value => {
      const options = { [key]: value };
      expect(() => new quic.Endpoint(options)).not.toThrow();
    });

    test.each(invalid)("invalid value: %p", value => {
      const options = { [key]: value };
      expect(() => new quic.Endpoint(options)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
          message: expect.any(String),
        }),
      );
    });
  });
}

//<#END_FILE: test-quic-internal-endpoint-options.js
