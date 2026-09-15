// These tests also pass in Node.js.
import { expect, it } from "bun:test";
import _http_server from "node:_http_server";
import http from "node:http";

it("http._connectionListener is the connection listener from _http_server", () => {
  expect(typeof http._connectionListener).toBe("function");
  expect(http._connectionListener).toBe(_http_server._connectionListener);
});

it("every http.Server registers _connectionListener on 'connection'", () => {
  const server = http.createServer();
  try {
    expect(server.listeners("connection")).toContain(http._connectionListener);
  } finally {
    server.close();
  }
});
