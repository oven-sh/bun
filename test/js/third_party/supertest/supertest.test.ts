import { expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import request from "supertest";

// https://github.com/oven-sh/bun/issues/27945
// A supertest request is a thenable, not a promise. It sends the request when then() or end() is called, and a
// second call is an error. `bun test` awaits a returned request through then(). With a done callback it does not
// call then(), because expect(status, done) already called end().
let requests = 0;
function app(_req: IncomingMessage, res: ServerResponse) {
  requests++;
  res.end("valid");
}

// The first request loads most of superagent. It is sent here, so that no test carries that cost.
await request(app).get("/");
requests = 0;

test("a returned request is sent and awaited", () => request(app).get("/").expect("valid"));

test.failing("a returned request whose expectation fails, fails the test", () =>
  request(app).get("/").expect("invalid"),
);

test("a returned request with a done callback is sent once", done => request(app).get("/").expect(200, done));

test("each test sent one request", () => {
  expect(requests).toBe(3);
});
