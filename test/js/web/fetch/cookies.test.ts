"use strict";

import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";

test("Can receive set-cookie headers from a server using fetch - issue #1262", async () => {
  await using server = createServer((req, res) => {
    res.setHeader("set-cookie", "name=value; Domain=example.com");
    res.end();
  }).listen(0);

  await once(server, "listening");

  const response = await fetch(`http://localhost:${server.address().port}`);

  expect(response.headers.get("set-cookie")).toBe("name=value; Domain=example.com");

  const response2 = await fetch(`http://localhost:${server.address().port}`, {
    credentials: "include",
  });

  expect(response2.headers.get("set-cookie")).toBe("name=value; Domain=example.com");
});

test("Can send cookies to a server with fetch - issue #1463", async () => {
  await using server = createServer((req, res) => {
    expect(req.headers.cookie).toBe("value");
    res.end();
  }).listen(0);

  await once(server, "listening");

  const headersInit = [new Headers([["cookie", "value"]]), { cookie: "value" }, [["cookie", "value"]]];

  for (const headers of headersInit) {
    await fetch(`http://localhost:${server.address().port}`, { headers });
  }
});

test("Cookie header is delimited with a semicolon rather than a comma - issue #1905", async () => {
  await using server = createServer((req, res) => {
    expect(req.headers.cookie).toBe("FOO=lorem-ipsum-dolor-sit-amet; BAR=the-quick-brown-fox");
    res.end();
  }).listen(0);

  await once(server, "listening");

  await fetch(`http://localhost:${server.address().port}`, {
    headers: [
      ["cookie", "FOO=lorem-ipsum-dolor-sit-amet"],
      ["cookie", "BAR=the-quick-brown-fox"],
    ],
  });
});

test.todo("Can receive set-cookie headers from a http2 server using fetch - issue #2885", async t => {
  // const server = createSecureServer(pem);
  // server.on("stream", async (stream, headers) => {
  //   stream.respond({
  //     "content-type": "text/plain; charset=utf-8",
  //     "x-method": headers[":method"],
  //     "set-cookie": "Space=Cat; Secure; HttpOnly",
  //     ":status": 200,
  //   });
  //   stream.end("test");
  // });
  // server.listen();
  // await once(server, "listening");
  // const client = new Client(`https://localhost:${server.address().port}`, {
  //   connect: {
  //     rejectUnauthorized: false,
  //   },
  //   allowH2: true,
  // });
  // const response = await fetch(
  //   `https://localhost:${server.address().port}/`,
  //   // Needs to be passed to disable the reject unauthorized
  //   {
  //     method: "GET",
  //     dispatcher: client,
  //     headers: {
  //       "content-type": "text-plain",
  //     },
  //   },
  // );
  // t.after(closeClientAndServerAsPromise(client, server));
  // assert.deepStrictEqual(response.headers.getSetCookie(), ["Space=Cat; Secure; HttpOnly"]);
});
