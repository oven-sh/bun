import { expect, test } from "bun:test";
import { tls } from "harness";
import https from "node:https";

test("node:https rejects a negative handshakeTimeout", () => {
  expect(() => https.createServer({ ...tls, handshakeTimeout: -1 })).toThrow(
    expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
  );
});
