import { test } from "bun:test";
import { tls } from "harness";
import https from "node:https";

test.each([-1, 0, 1])("node:https accepts handshakeTimeout %d", handshakeTimeout => {
  const server = https.createServer({ ...tls, handshakeTimeout });
  server.close();
});
