//#FILE: test-http-proxy.js
//#SHA1: 7b000418a5941e059d64a57b2f0b4fdfb43eb71d
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
const http = require("http");
const url = require("url");

const cookies = [
  "session_token=; path=/; expires=Sun, 15-Sep-2030 13:48:52 GMT",
  "prefers_open_id=; path=/; expires=Thu, 01-Jan-1970 00:00:00 GMT",
];

const headers = { "content-type": "text/plain", "set-cookie": cookies, hello: "world" };

test("HTTP proxy server", async () => {
  const backend = http.createServer((req, res) => {
    console.error("backend request");
    res.writeHead(200, headers);
    res.write("hello world\n");
    res.end();
  });

  const proxy = http.createServer((req, res) => {
    console.error(`proxy req headers: ${JSON.stringify(req.headers)}`);
    http.get(
      {
        port: backend.address().port,
        path: url.parse(req.url).pathname,
      },
      proxy_res => {
        console.error(`proxy res headers: ${JSON.stringify(proxy_res.headers)}`);

        expect(proxy_res.headers.hello).toBe("world");
        expect(proxy_res.headers["content-type"]).toBe("text/plain");
        expect(proxy_res.headers["set-cookie"]).toEqual(cookies);

        res.writeHead(proxy_res.statusCode, proxy_res.headers);

        proxy_res.on("data", chunk => {
          res.write(chunk);
        });

        proxy_res.on("end", () => {
          res.end();
          console.error("proxy res");
        });
      },
    );
  });

  let body = "";

  await new Promise(resolve => {
    let nlistening = 0;
    function startReq() {
      nlistening++;
      if (nlistening < 2) return;

      http.get(
        {
          port: proxy.address().port,
          path: "/test",
        },
        res => {
          console.error("got res");
          expect(res.statusCode).toBe(200);

          expect(res.headers.hello).toBe("world");
          expect(res.headers["content-type"]).toBe("text/plain");
          expect(res.headers["set-cookie"]).toEqual(cookies);

          res.setEncoding("utf8");
          res.on("data", chunk => {
            body += chunk;
          });
          res.on("end", () => {
            proxy.close();
            backend.close();
            console.error("closed both");
            resolve();
          });
        },
      );
      console.error("client req");
    }

    console.error("listen proxy");
    proxy.listen(0, startReq);

    console.error("listen backend");
    backend.listen(0, startReq);
  });

  expect(body).toBe("hello world\n");
});

//<#END_FILE: test-http-proxy.js
