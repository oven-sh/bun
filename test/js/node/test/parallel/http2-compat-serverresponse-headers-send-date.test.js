//#FILE: test-http2-compat-serverresponse-headers-send-date.js
//#SHA1: 1ed6319986a3bb9bf58709d9577d03407fdde3f2
//-----------------
"use strict";
const http2 = require("http2");

let server;
let port;

beforeAll(done => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }

  server = http2.createServer((request, response) => {
    response.sendDate = false;
    response.writeHead(200);
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

test("HTTP/2 server response should not send Date header when sendDate is false", done => {
  const session = http2.connect(`http://localhost:${port}`);
  const req = session.request();

  req.on("response", (headers, flags) => {
    expect(headers).not.toHaveProperty("Date");
    expect(headers).not.toHaveProperty("date");
  });

  req.on("end", () => {
    session.close();
    done();
  });

  req.end();
});

//<#END_FILE: test-http2-compat-serverresponse-headers-send-date.js
