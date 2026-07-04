import { expect, test } from "bun:test";
import net from "node:net";

// RFC 9110 section 5.3: repeated field lines combine into one comma-separated value.
// Raw socket client because `new Headers()` already combines before anything is sent.
test("repeated request headers are combined, not replaced", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: req => Response.json(Object.fromEntries(req.headers)),
  });

  await using socket = net.connect(server.port, "127.0.0.1", () =>
    socket.write(
      "GET / HTTP/1.1\r\n" +
        "Host: x\r\n" +
        // well-known name: already combined before this test
        "vary: a\r\n" +
        "vary: b\r\n" +
        // uncommon name: used to keep only the last value
        "x-uncommon: a\r\n" +
        "x-uncommon: b\r\n" +
        // an empty repeat must not erase the value that came before it
        "x-keep: HIT\r\n" +
        "x-keep:\r\n" +
        "Connection: close\r\n" +
        "\r\n",
    ),
  );

  let raw = "";
  socket.on("data", chunk => (raw += chunk));
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.on("close", () => resolve());
  socket.on("error", reject);
  await promise;

  const body = JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4));
  expect({ vary: body.vary, uncommon: body["x-uncommon"], keep: body["x-keep"] }).toEqual({
    vary: "a, b",
    uncommon: "a, b",
    keep: "HIT, ",
  });
});

// https://github.com/oven-sh/bun/issues/9180
test("weird headers", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.append(key, value);
      });

      return new Response("OK", {
        headers,
      });
    },
  });

  {
    for (let i = 0; i < 255; i++) {
      const headers = new Headers();
      const name = "X-" + String.fromCharCode(i);
      try {
        headers.set(name, "1");
      } catch {
        continue;
      }

      const res = await fetch(server.url, {
        headers,
      });
      expect(res.headers.get(name)).toBe("1");
    }
  }
});
