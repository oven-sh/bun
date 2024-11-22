//#FILE: test-http2-compat-aborted.js
//#SHA1: 2aaf11840d98c2b8f4387473180ec86626ac48d1
//-----------------
"use strict";

const h2 = require("http2");

let server;
let port;

beforeAll(done => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }
  server = h2.createServer((req, res) => {
    req.on("aborted", () => {
      expect(req.aborted).toBe(true);
      expect(req.complete).toBe(true);
    });
    expect(req.aborted).toBe(false);
    expect(req.complete).toBe(false);
    res.write("hello");
    server.close();
  });

  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll(() => {
  if (server) {
    server.close();
  }
});

test("HTTP/2 compat aborted", done => {
  const url = `http://localhost:${port}`;
  const client = h2.connect(url, () => {
    const request = client.request();
    request.on("data", chunk => {
      client.destroy();
    });
    request.on("end", () => {
      done();
    });
  });

  client.on("error", err => {
    // Ignore client errors as we're forcibly destroying the connection
  });
});

//<#END_FILE: test-http2-compat-aborted.js
