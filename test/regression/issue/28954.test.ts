// https://github.com/oven-sh/bun/issues/28954
//
// MKADDRESSBOOK is a CardDAV extension method (analogous to MKCALENDAR for
// CalDAV) that was missing from Bun's HTTP method allowlist. Bun.serve would
// drop the request entirely and fetch() would silently rewrite the method to
// GET.
//
// Note: Bun's node:http.METHODS (a hand-maintained array in
// src/js/internal/http.ts) intentionally mirrors Node.js's list for API
// compatibility, and Node derives that list from llhttp which doesn't know
// about MKADDRESSBOOK — so METHODS is deliberately left alone here.
import { expect, test } from "bun:test";
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
  const { promise, resolve, reject } = Promise.withResolvers<string>();

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
  try {
    const { promise: connected, resolve: resolveConnect, reject: rejectConnect } = Promise.withResolvers<void>();
    socket.once("connect", () => resolveConnect());
    socket.once("error", rejectConnect);
    await connected;

    // Any post-connect socket error rejects the method-observation promise so
    // we don't hang if something goes wrong on the wire. We deliberately don't
    // hook `close` here — in the happy path the server replies and closes the
    // keep-alive socket, which would race the fetch-handler resolve.
    socket.once("error", reject);
    socket.write(`MKADDRESSBOOK / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n`);

    // Wait for the server handler to observe the method.
    const method = await promise;
    expect(method).toBe("MKADDRESSBOOK");
  } finally {
    socket.destroy();
  }
});
