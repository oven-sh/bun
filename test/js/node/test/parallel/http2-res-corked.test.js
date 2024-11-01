//#FILE: test-http2-res-corked.js
//#SHA1: a6c5da9f22eae611c043c6d177d63c0eaca6e02e
//-----------------
"use strict";
const http2 = require("http2");

// Skip the test if crypto is not available
let hasCrypto = false;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  // crypto not available
}

(hasCrypto ? describe : describe.skip)("Http2ServerResponse#[writableCorked,cork,uncork]", () => {
  let server;
  let client;
  let corksLeft = 0;

  beforeAll(done => {
    server = http2.createServer((req, res) => {
      expect(res.writableCorked).toBe(corksLeft);
      res.write(Buffer.from("1".repeat(1024)));
      res.cork();
      corksLeft++;
      expect(res.writableCorked).toBe(corksLeft);
      res.write(Buffer.from("1".repeat(1024)));
      res.cork();
      corksLeft++;
      expect(res.writableCorked).toBe(corksLeft);
      res.write(Buffer.from("1".repeat(1024)));
      res.cork();
      corksLeft++;
      expect(res.writableCorked).toBe(corksLeft);
      res.write(Buffer.from("1".repeat(1024)));
      res.cork();
      corksLeft++;
      expect(res.writableCorked).toBe(corksLeft);
      res.uncork();
      corksLeft--;
      expect(res.writableCorked).toBe(corksLeft);
      res.uncork();
      corksLeft--;
      expect(res.writableCorked).toBe(corksLeft);
      res.uncork();
      corksLeft--;
      expect(res.writableCorked).toBe(corksLeft);
      res.uncork();
      corksLeft--;
      expect(res.writableCorked).toBe(corksLeft);
      res.end();
    });

    server.listen(0, () => {
      const port = server.address().port;
      client = http2.connect(`http://localhost:${port}`);
      done();
    });
  });

  afterAll(() => {
    client.close();
    server.close();
  });

  test("cork and uncork operations", done => {
    const req = client.request();
    let dataCallCount = 0;
    req.on("data", () => {
      dataCallCount++;
    });
    req.on("end", () => {
      expect(dataCallCount).toBe(2);
      done();
    });
  });
});
//<#END_FILE: test-http2-res-corked.js
