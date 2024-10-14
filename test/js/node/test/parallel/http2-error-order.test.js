//#FILE: test-http2-error-order.js
//#SHA1: 6bbd1a1d706948206d095a0ca5e3238a86b7716d
//-----------------
"use strict";

const http2 = require("http2");

const messages = [];
const expected = ["Stream:created", "Stream:error", "Stream:close", "Request:error"];

let server;

beforeAll(() => {
  server = http2.createServer();

  server.on("stream", stream => {
    messages.push("Stream:created");
    stream
      .on("close", () => messages.push("Stream:close"))
      .on("error", () => messages.push("Stream:error"))
      .respondWithFile("dont exist");
  });
});

afterAll(() => {
  server.close();
});

test("HTTP/2 error order", done => {
  server.listen(0, () => {
    const client = http2.connect(`http://localhost:${server.address().port}`);
    const req = client.request();

    req.on("response", () => {
      throw new Error("response event should not be called");
    });

    req.on("error", () => {
      console.error("error");

      messages.push("Request:error");
      client.close();
    });

    client.on("close", () => {
      expect(messages).toEqual(expected);
      done();
    });
  });
});

//<#END_FILE: test-http2-error-order.js
