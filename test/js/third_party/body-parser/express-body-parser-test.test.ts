// @ts-nocheck
// can't use @types/express or @types/body-parser because they
// depend on @types/node which conflicts with bun-types
import { test, expect } from "bun:test";
import express, { Application, Request, Response } from "express";
import { json } from "body-parser";

// Express uses iconv-lite
test("iconv works", () => {
  var iconv = require("iconv-lite");

  // Convert from an encoded buffer to a js string.
  var str = iconv.decode(Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f]), "win1251");

  // Convert from a js string to an encoded buffer.
  var buf = iconv.encode("Sample input string", "win1251");
  expect(str).toBe("hello");
  expect(iconv.decode(buf, "win1251")).toBe("Sample input string");

  // Check if encoding is supported
  expect(iconv.encodingExists("us-ascii")).toBe(true);
});

// https://github.com/oven-sh/bun/issues/1913
test("httpServer", async () => {
  // Constants
  const PORT = 8412;

  // App handlers
  const app: Application = express();
  const httpServer = require("http").createServer(app);

  app.on("error", err => {
    console.error(err);
  });
  app.use(json());

  var reached = false;
  // This throws a TypeError since it uses body-parser.json
  app.post("/ping", (request: Request, response: Response) => {
    expect(request.body).toEqual({ hello: "world" });
    expect(request.query).toStrictEqual({
      hello: "123",
      hi: "",
    });
    reached = true;
    response.status(200).send("POST - pong");
    httpServer.close();
  });

  httpServer.listen(PORT);
  const resp = await fetch(`http://localhost:${PORT}/ping?hello=123&hi`, {
    method: "POST",
    body: JSON.stringify({ hello: "world" }),
    headers: {
      "Content-Type": "application/json",
    },
  });
  expect(await resp.text()).toBe("POST - pong");
  expect(resp.status).toBe(200);

  expect(reached).toBe(true);
});
