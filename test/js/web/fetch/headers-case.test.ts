"use strict";

import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";

test.todo("Headers retain keys case-sensitive", async () => {
  await using server = createServer((req, res) => {
    expect(req.rawHeaders.includes("Content-Type")).toBe(true);

    res.end();
  }).listen(0);

  await once(server, "listening");

  const url = `http://localhost:${server.address().port}`;
  for (const headers of [
    new Headers([["Content-Type", "text/plain"]]),
    { "Content-Type": "text/plain" },
    [["Content-Type", "text/plain"]],
  ]) {
    await fetch(url, { headers });
  }
  // see https://github.com/nodejs/undici/pull/3183
  await fetch(new Request(url, { headers: [["Content-Type", "text/plain"]] }), { method: "GET" });
});
