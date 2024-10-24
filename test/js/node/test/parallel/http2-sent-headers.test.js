//#FILE: test-http2-sent-headers.js
//#SHA1: cbc2db06925ef62397fd91d70872b787363cd96c
//-----------------
"use strict";

const h2 = require("http2");

const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch (err) {
    return false;
  }
})();

(hasCrypto ? describe : describe.skip)("http2 sent headers", () => {
  let server;
  let client;
  let port;

  beforeAll(done => {
    server = h2.createServer();

    server.on("stream", stream => {
      stream.additionalHeaders({ ":status": 102 });
      expect(stream.sentInfoHeaders[0][":status"]).toBe(102);

      stream.respond({ abc: "xyz" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => {
        stream.sendTrailers({ xyz: "abc" });
      });
      expect(stream.sentHeaders.abc).toBe("xyz");
      expect(stream.sentHeaders[":status"]).toBe(200);
      expect(stream.sentHeaders.date).toBeDefined();
      stream.end();
      stream.on("close", () => {
        expect(stream.sentTrailers.xyz).toBe("abc");
      });
    });

    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("client request headers", done => {
    client = h2.connect(`http://localhost:${port}`);
    const req = client.request();

    req.on("headers", (headers, flags) => {
      expect(headers[":status"]).toBe(102);
      expect(typeof flags).toBe("number");
    });

    expect(req.sentHeaders[":method"]).toBe("GET");
    expect(req.sentHeaders[":authority"]).toBe(`localhost:${port}`);
    expect(req.sentHeaders[":scheme"]).toBe("http");
    expect(req.sentHeaders[":path"]).toBe("/");

    req.resume();
    req.on("close", () => {
      client.close();
      done();
    });
  });
});

//<#END_FILE: test-http2-sent-headers.js
