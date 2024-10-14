//#FILE: test-http2-compat-write-head-destroyed.js
//#SHA1: 29f693f49912d4621c1a19ab7412b1b318d55d8e
//-----------------
"use strict";

const http2 = require("http2");

let server;
let port;

beforeAll(done => {
  if (!process.versions.openssl) {
    done();
    return;
  }

  server = http2.createServer((req, res) => {
    // Destroy the stream first
    req.stream.destroy();

    res.writeHead(200);
    res.write("hello ");
    res.end("world");
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

test("writeHead, write and end do not crash in compatibility mode", done => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }

  const client = http2.connect(`http://localhost:${port}`);

  const req = client.request();

  req.on("response", () => {
    done.fail("Should not receive response");
  });

  req.on("close", () => {
    client.close();
    done();
  });

  req.resume();
});

//<#END_FILE: test-http2-compat-write-head-destroyed.js
