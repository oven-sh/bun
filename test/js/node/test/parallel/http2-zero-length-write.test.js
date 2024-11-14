//#FILE: test-http2-zero-length-write.js
//#SHA1: a948a83af3675490313ff7b33a36d2c12cdd2837
//-----------------
"use strict";

const http2 = require("http2");
const { Readable } = require("stream");

function getSrc() {
  const chunks = ["", "asdf", "", "foo", "", "bar", ""];
  return new Readable({
    read() {
      const chunk = chunks.shift();
      if (chunk !== undefined) this.push(chunk);
      else this.push(null);
    },
  });
}

const expectedOutput = "asdffoobar";

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    test.skip("missing crypto");
  }
});

afterEach(() => {
  if (client) client.close();
  if (server) server.close();
});

test("HTTP/2 zero length write", async () => {
  return new Promise((resolve, reject) => {
    server = http2.createServer();
    server.on("stream", stream => {
      let actual = "";
      stream.respond();
      stream.resume();
      stream.setEncoding("utf8");
      stream.on("data", chunk => (actual += chunk));
      stream.on("end", () => {
        getSrc().pipe(stream);
        expect(actual).toBe(expectedOutput);
      });
    });

    server.listen(0, () => {
      client = http2.connect(`http://localhost:${server.address().port}`);
      let actual = "";
      const req = client.request({ ":method": "POST" });
      req.on("response", () => {});
      req.setEncoding("utf8");
      req.on("data", chunk => (actual += chunk));

      req.on("end", () => {
        expect(actual).toBe(expectedOutput);
        resolve();
      });
      getSrc().pipe(req);
    });
  });
}, 10000); // Increase timeout to 10 seconds

//<#END_FILE: test-http2-zero-length-write.js
