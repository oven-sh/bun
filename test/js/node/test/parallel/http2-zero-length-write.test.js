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

const expect = "asdffoobar";

test("HTTP/2 zero length write", async () => {
  if (!("crypto" in process)) {
    return;
  }

  const server = http2.createServer();
  server.on("stream", stream => {
    let actual = "";
    stream.respond();
    stream.resume();
    stream.setEncoding("utf8");
    stream.on("data", chunk => (actual += chunk));
    stream.on("end", () => {
      getSrc().pipe(stream);
      expect(actual).toBe(expect);
    });
  });

  await new Promise(resolve => server.listen(0, resolve));

  const client = http2.connect(`http://localhost:${server.address().port}`);
  let actual = "";
  const req = client.request({ ":method": "POST" });
  req.on("response", jest.fn());
  req.setEncoding("utf8");
  req.on("data", chunk => (actual += chunk));

  await new Promise(resolve => {
    req.on("end", () => {
      expect(actual).toBe(expect);
      server.close();
      client.close();
      resolve();
    });
    getSrc().pipe(req);
  });
});

//<#END_FILE: test-http2-zero-length-write.js
