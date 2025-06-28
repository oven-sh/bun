// @ts-nocheck
// can't use @types/express or @types/body-parser because they
// depend on @types/node which conflicts with bun-types
import { expect, test } from "bun:test";
import express from "express";
import { isIPv6 } from "node:net";
// https://github.com/oven-sh/bun/issues/8926
test("should respond with 404 when wrong method is used", async () => {
  const { promise: serve, resolve } = Promise.withResolvers();
  const app = express();
  app.use(express.json());

  app.get("/api/hotels", (req, res) => {
    res.json({
      success: true,
    });
  });

  const server = app.listen(0, (_, host, port) => {
    if (isIPv6(host)) {
      resolve(`http://[${host}]:${port}`);
    } else {
      resolve(`http://${host}:${port}`);
    }
  });

  try {
    const url = await serve;
    const response = await fetch(`${url}/api/hotels`, {
      method: "POST",
      signal: AbortSignal.timeout(500),
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Hotel 1",
        price: 100,
      }),
    });
    expect(response.status).toBe(404);
  } finally {
    server.close();
  }
});
