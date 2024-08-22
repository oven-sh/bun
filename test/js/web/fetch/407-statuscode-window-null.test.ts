import { createServer } from "node:http";
import { once } from "node:events";
import { test, expect } from "bun:test";

test("Receiving a 407 status code w/ a window option present should reject", async () => {
  await using server = createServer((req, res) => {
    res.statusCode = 407;
    res.end();
  }).listen(0);

  await once(server, "listening");

  // if init.window exists, the spec tells us to set request.window to 'no-window',
  // which later causes the request to be rejected if the status code is 407
  expect(fetch(`http://localhost:${server.address().port}`)).rejects.pass();
});
