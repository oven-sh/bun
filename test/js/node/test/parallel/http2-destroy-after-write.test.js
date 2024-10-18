//#FILE: test-http2-destroy-after-write.js
//#SHA1: 193688397df0b891b9286ff825ca873935d30e04
//-----------------
"use strict";

const http2 = require("http2");

let server;
let port;

beforeAll(done => {
  server = http2.createServer();

  server.on("session", session => {
    session.on("stream", stream => {
      stream.on("end", function () {
        this.respond({
          ":status": 200,
        });
        this.write("foo");
        this.destroy();
      });
      stream.resume();
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

test("http2 destroy after write", done => {
  const client = http2.connect(`http://localhost:${port}`);
  const stream = client.request({ ":method": "POST" });

  stream.on("response", headers => {
    expect(headers[":status"]).toBe(200);
  });

  stream.on("close", () => {
    client.close();
    done();
  });

  stream.resume();
  stream.end();
});

//<#END_FILE: test-http2-destroy-after-write.js
