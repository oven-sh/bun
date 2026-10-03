// @ts-nocheck
// can't use @types/express or @types/body-parser because they
// depend on @types/node which conflicts with bun-types
import { expect, test } from "bun:test";
import express from "express";
import { isASAN, isDebug } from "harness";
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

  const server = app.listen(0, () => {
    resolve(`http://localhost:${server.address().port}`);
  });

  try {
    const url = await serve;
    const response = await fetch(`${url}/api/hotels`, {
      method: "POST",
      // The hang guard for #8926. The first request takes about 730 ms on a debug ASAN build.
      signal: AbortSignal.timeout(isDebug || isASAN ? 5000 : 500),
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
