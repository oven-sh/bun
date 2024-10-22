//#FILE: test-http2-removed-header-stays-removed.js
//#SHA1: f8bc3d1be9927b83a02492d9cb44c803c337e3c1
//-----------------
"use strict";
const http2 = require("http2");

let server;
let port;

beforeAll(done => {
  server = http2.createServer((request, response) => {
    response.setHeader("date", "snacks o clock");
    response.end();
  });

  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll(() => {
  server.close();
});

test("HTTP/2 removed header stays removed", done => {
  const session = http2.connect(`http://localhost:${port}`);
  const req = session.request();

  req.on("response", (headers, flags) => {
    expect(headers.date).toBe("snacks o clock");
  });

  req.on("end", () => {
    session.close();
    done();
  });
});

// Conditional skip if crypto is not available
try {
  require("crypto");
} catch (err) {
  test.skip("missing crypto", () => {});
}

//<#END_FILE: test-http2-removed-header-stays-removed.js
