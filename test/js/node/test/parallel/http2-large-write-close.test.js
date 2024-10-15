//#FILE: test-http2-large-write-close.js
//#SHA1: 66ad4345c0888700887c23af455fdd9ff49721d9
//-----------------
"use strict";
const fixtures = require("../common/fixtures");
const http2 = require("http2");

const content = Buffer.alloc(1e5, 0x44);

let server;
let port;

beforeAll(done => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }

  server = http2.createSecureServer({
    key: fixtures.readKey("agent1-key.pem"),
    cert: fixtures.readKey("agent1-cert.pem"),
  });

  server.on("stream", stream => {
    stream.respond({
      "Content-Type": "application/octet-stream",
      "Content-Length": content.length.toString() * 2,
      "Vary": "Accept-Encoding",
    });

    stream.write(content);
    stream.write(content);
    stream.end();
    stream.close();
  });

  server.listen(0, () => {
    port = server.address().port;
    done();
  });
});

afterAll(() => {
  server.close();
});

test("HTTP/2 large write and close", done => {
  const client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });

  const req = client.request({ ":path": "/" });
  req.end();

  let receivedBufferLength = 0;
  req.on("data", buf => {
    receivedBufferLength += buf.length;
  });

  req.on("close", () => {
    expect(receivedBufferLength).toBe(content.length * 2);
    client.close();
    done();
  });
});

//<#END_FILE: test-http2-large-write-close.js
