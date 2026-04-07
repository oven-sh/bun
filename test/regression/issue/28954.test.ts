// https://github.com/oven-sh/bun/issues/28954
//
// MKADDRESSBOOK is a CardDAV extension method (analogous to MKCALENDAR for
// CalDAV) that was missing from Bun's HTTP method allowlist. Bun.serve would
// drop the request entirely and fetch() would silently rewrite the method to
// GET.
import { test, expect } from "bun:test";
import { METHODS } from "node:http";
import { connect } from "node:net";

test("Bun.serve receives MKADDRESSBOOK via fetch()", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(req.method);
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, { method: "MKADDRESSBOOK" });
  expect(await res.text()).toBe("MKADDRESSBOOK");
  expect(res.status).toBe(200);
});

test("Bun.serve receives MKADDRESSBOOK from a raw TCP request", async () => {
  const { promise, resolve } = Promise.withResolvers<string>();

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      resolve(req.method);
      return new Response("ok");
    },
  });

  // Write a raw HTTP request so the server-side method parser runs
  // independent of fetch()'s client-side method validation.
  const socket = connect(server.port, "127.0.0.1");
  const { promise: connected, resolve: resolveConnect, reject: rejectConnect } = Promise.withResolvers<void>();
  socket.once("connect", () => resolveConnect());
  socket.once("error", rejectConnect);
  await connected;
  socket.write(`MKADDRESSBOOK / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n`);

  // Wait for the server handler to observe the method, then tear the socket down.
  const method = await promise;
  socket.destroy();
  expect(method).toBe("MKADDRESSBOOK");
});

test("http.METHODS includes MKADDRESSBOOK", () => {
  expect(METHODS).toContain("MKADDRESSBOOK");
});
