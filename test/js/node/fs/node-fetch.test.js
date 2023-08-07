import fetch2, { fetch, Response, Request, Headers } from "node-fetch";

import { test, expect } from "bun:test";

test("node-fetch", () => {
  expect(Response).toBe(globalThis.Response);
  expect(Request).toBe(globalThis.Request);
  expect(Headers).toBe(globalThis.Headers);
});

test("node-fetch fetches", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      server.stop();
      return new Response();
    },
  });
  expect(await fetch("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(Response);
  server.stop(true);
});

test("node-fetch.default fetches", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      server.stop();
      return new Response();
    },
  });
  expect(await fetch2("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(Response);
  server.stop(true);
});

test("node-fetch.default.default fetches", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      server.stop();
      return new Response();
    },
  });
  expect(await fetch2.default("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(Response);
  server.stop(true);
});
