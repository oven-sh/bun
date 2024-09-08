//#FILE: test-http-header-owstext.js
//#SHA1: 339bfcf13a4cc9caa39940de3854eeda01b4500c
//-----------------
"use strict";

const http = require("http");
const net = require("net");

// This test ensures that the http-parser strips leading and trailing OWS from
// header values. It sends the header values in chunks to force the parser to
// build the string up through multiple calls to on_header_value().

function check(hdr, snd, rcv) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      expect(req.headers[hdr]).toBe(rcv);
      req.pipe(res);
    });

    server.listen(0, function () {
      const client = net.connect(this.address().port, start);
      function start() {
        client.write("GET / HTTP/1.1\r\n" + hdr + ":", drain);
      }

      function drain() {
        if (snd.length === 0) {
          return client.write("\r\nConnection: close\r\n\r\n");
        }
        client.write(snd.shift(), drain);
      }

      const bufs = [];
      client.on("data", function (chunk) {
        bufs.push(chunk);
      });
      client.on("end", function () {
        const head = Buffer.concat(bufs).toString("latin1").split("\r\n")[0];
        expect(head).toBe("HTTP/1.1 200 OK");
        server.close();
        resolve();
      });
    });
  });
}

test("http header OWS text parsing", async () => {
  await check("host", [" \t foo.com\t"], "foo.com");
  await check("host", [" \t foo\tcom\t"], "foo\tcom");
  await check("host", [" \t", " ", " foo.com\t", "\t "], "foo.com");
  await check("host", [" \t", " \t".repeat(100), "\t "], "");
  await check("host", [" \t", " - - - -   ", "\t "], "- - - -");
});

//<#END_FILE: test-http-header-owstext.js
