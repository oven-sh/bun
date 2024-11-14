//#FILE: test-http-server-multiheaders.js
//#SHA1: 48e657fa74fb8aeeb2d04661ac760ff0cf5bf12a
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
// Verify that the HTTP server implementation handles multiple instances
// of the same header as per RFC2616: joining the handful of fields by ', '
// that support it, and dropping duplicates for other fields.

const http = require("http");

test("HTTP server handles multiple instances of the same header correctly", async () => {
  const server = http.createServer((req, res) => {
    expect(req.headers.accept).toBe("abc, def, ghijklmnopqrst");
    expect(req.headers.host).toBe("foo");
    expect(req.headers["www-authenticate"]).toBe("foo, bar, baz");
    expect(req.headers["proxy-authenticate"]).toBe("foo, bar, baz");
    expect(req.headers["x-foo"]).toBe("bingo");
    expect(req.headers["x-bar"]).toBe("banjo, bango");
    expect(req.headers["sec-websocket-protocol"]).toBe("chat, share");
    expect(req.headers["sec-websocket-extensions"]).toBe("foo; 1, bar; 2, baz");
    expect(req.headers.constructor).toBe("foo, bar, baz");

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("EOF");

    server.close();
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get({
        host: "localhost",
        port: server.address().port,
        path: "/",
        headers: [
          ["accept", "abc"],
          ["accept", "def"],
          ["Accept", "ghijklmnopqrst"],
          ["host", "foo"],
          ["Host", "bar"],
          ["hOst", "baz"],
          ["www-authenticate", "foo"],
          ["WWW-Authenticate", "bar"],
          ["WWW-AUTHENTICATE", "baz"],
          ["proxy-authenticate", "foo"],
          ["Proxy-Authenticate", "bar"],
          ["PROXY-AUTHENTICATE", "baz"],
          ["x-foo", "bingo"],
          ["x-bar", "banjo"],
          ["x-bar", "bango"],
          ["sec-websocket-protocol", "chat"],
          ["sec-websocket-protocol", "share"],
          ["sec-websocket-extensions", "foo; 1"],
          ["sec-websocket-extensions", "bar; 2"],
          ["sec-websocket-extensions", "baz"],
          ["constructor", "foo"],
          ["constructor", "bar"],
          ["constructor", "baz"],
        ],
      });
      resolve();
    });
  });
});

//<#END_FILE: test-http-server-multiheaders.js
