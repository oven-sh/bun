//#FILE: test-http2-zero-length-header.js
//#SHA1: 65bd4ca954be7761c2876b26c6ac5d3f0e5c98e4
//-----------------
"use strict";
const http2 = require("http2");

// Skip test if crypto is not available
const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch (err) {
    return false;
  }
})();

(hasCrypto ? describe : describe.skip)("http2 zero length header", () => {
  let server;
  let port;

  beforeAll(async () => {
    server = http2.createServer();
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(() => {
    server.close();
  });

  test("server receives correct headers", async () => {
    const serverPromise = new Promise(resolve => {
      server.once("stream", (stream, headers) => {
        expect(headers).toEqual({
          ":scheme": "http",
          ":authority": `localhost:${port}`,
          ":method": "GET",
          ":path": "/",
          "bar": "",
          "__proto__": null,
          [http2.sensitiveHeaders]: [],
        });
        stream.session.destroy();
        resolve();
      });
    });

    const client = http2.connect(`http://localhost:${port}/`);
    client.request({ ":path": "/", "": "foo", "bar": "" }).end();

    await serverPromise;
    client.close();
  });
});

//<#END_FILE: test-http2-zero-length-header.js
