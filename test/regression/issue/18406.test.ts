import { expect, test } from "bun:test";
import { createServer } from "net";

// https://github.com/oven-sh/bun/issues/18406
// Unknown random HTTP methods should not be silently routed to GET handlers

test("fetch() with unknown method sends correct method on wire", async () => {
  // Use a raw TCP server to verify what fetch actually sends
  const receivedMethods: string[] = [];
  const server = createServer((socket: any) => {
    socket.on("data", (data: Buffer) => {
      const line = data.toString().split("\r\n")[0];
      const method = line.split(" ")[0];
      receivedMethods.push(method);
      socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      socket.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    await fetch(`http://localhost:${port}/test`, { method: "CHICKEN" });
    await fetch(`http://localhost:${port}/test`, { method: "BUN" });
    await fetch(`http://localhost:${port}/test`, { method: "GET" });
    await fetch(`http://localhost:${port}/test`, { method: "POST" });
    await fetch(`http://localhost:${port}/test`, { method: "PATCH" });

    expect(receivedMethods).toEqual(["CHICKEN", "BUN", "GET", "POST", "PATCH"]);
  } finally {
    server.close();
  }
});

test("Bun.serve() with routes does not route unknown methods to GET handler", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: {
      "/test": {
        GET: () => new Response("get handler"),
      },
    },
  });

  // GET should work as normal
  const getRes = await fetch(new URL("/test", server.url), { method: "GET" });
  expect(getRes.status).toBe(200);
  expect(await getRes.text()).toBe("get handler");

  // Unknown methods should NOT be routed to the GET handler
  const bunRes = await fetch(new URL("/test", server.url), { method: "BUN" });
  expect(bunRes.status).not.toBe(200);

  // Known but unregistered methods should return 404
  const postRes = await fetch(new URL("/test", server.url), { method: "POST" });
  expect(postRes.status).toBe(404);
});

test("Bun.serve() with fetch handler receives requests with unknown methods", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: {
      "/test": {
        GET: () => new Response("get handler"),
      },
    },
    fetch(req) {
      return new Response("fetch handler", { status: 418 });
    },
  });

  // GET should still route to the specific handler
  const getRes = await fetch(new URL("/test", server.url), { method: "GET" });
  expect(getRes.status).toBe(200);
  expect(await getRes.text()).toBe("get handler");

  // Unknown method should fall through to fetch handler, not GET route
  const bunRes = await fetch(new URL("/test", server.url), { method: "BUN" });
  expect(bunRes.status).toBe(418);
  expect(await bunRes.text()).toBe("fetch handler");

  // POST should also go to fetch handler since no POST route defined
  const postRes = await fetch(new URL("/test", server.url), { method: "POST" });
  expect(postRes.status).toBe(418);
  expect(await postRes.text()).toBe("fetch handler");
});

test("fetch() rejects invalid HTTP method tokens", async () => {
  // Methods with spaces should be rejected
  expect(fetch("http://localhost:1/test", { method: "INVALID METHOD" })).rejects.toThrow();

  // Empty method should be rejected
  expect(fetch("http://localhost:1/test", { method: "" })).rejects.toThrow();

  // Methods with special characters should be rejected
  expect(fetch("http://localhost:1/test", { method: "GET\r\n" })).rejects.toThrow();
});
