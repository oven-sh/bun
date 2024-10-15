//#FILE: test-http2-compat-serverresponse-flushheaders.js
//#SHA1: ea772e05a29f43bd7b61e4d70f24b94c1e1e201c
//-----------------
"use strict";

const h2 = require("http2");

let server;
let serverResponse;

beforeAll(done => {
  server = h2.createServer();
  server.listen(0, () => {
    done();
  });
});

afterAll(() => {
  server.close();
});

test("Http2ServerResponse.flushHeaders", done => {
  const port = server.address().port;

  server.once("request", (request, response) => {
    expect(response.headersSent).toBe(false);
    expect(response._header).toBe(false); // Alias for headersSent
    response.flushHeaders();
    expect(response.headersSent).toBe(true);
    expect(response._header).toBe(true);
    response.flushHeaders(); // Idempotent

    expect(() => {
      response.writeHead(400, { "foo-bar": "abc123" });
    }).toThrow(
      expect.objectContaining({
        code: "ERR_HTTP2_HEADERS_SENT",
      }),
    );
    response.on("finish", () => {
      process.nextTick(() => {
        response.flushHeaders(); // Idempotent
        done();
      });
    });
    serverResponse = response;
  });

  const url = `http://localhost:${port}`;
  const client = h2.connect(url, () => {
    const headers = {
      ":path": "/",
      ":method": "GET",
      ":scheme": "http",
      ":authority": `localhost:${port}`,
    };
    const request = client.request(headers);
    request.on("response", (headers, flags) => {
      expect(headers["foo-bar"]).toBeUndefined();
      expect(headers[":status"]).toBe(200);
      serverResponse.end();
    });
    request.on("end", () => {
      client.close();
    });
    request.end();
    request.resume();
  });
});

//<#END_FILE: test-http2-compat-serverresponse-flushheaders.js
