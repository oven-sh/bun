//#FILE: test-http-extra-response.js
//#SHA1: 0d2dfa2459e54fa9f1b90a609c328afd478f2793
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
const net = require("net");

// If an HTTP server is broken and sends data after the end of the response,
// node should ignore it and drop the connection.
// Demos this bug: https://github.com/joyent/node/issues/680

const body = "hello world\r\n";
const fullResponse =
  "HTTP/1.1 500 Internal Server Error\r\n" +
  `Content-Length: ${body.length}\r\n` +
  "Content-Type: text/plain\r\n" +
  "Date: Fri + 18 Feb 2011 06:22:45 GMT\r\n" +
  "Host: 10.20.149.2\r\n" +
  "Access-Control-Allow-Credentials: true\r\n" +
  "Server: badly broken/0.1 (OS NAME)\r\n" +
  "\r\n" +
  body;

test("HTTP server sending data after response end", async () => {
  const server = net.createServer(socket => {
    let postBody = "";

    socket.setEncoding("utf8");

    socket.on("data", chunk => {
      postBody += chunk;

      if (postBody.includes("\r\n")) {
        socket.write(fullResponse);
        socket.end(fullResponse);
      }
    });

    socket.on("error", err => {
      expect(err.code).toBe("ECONNRESET");
    });
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const { port } = server.address();

  const consoleLogSpy = jest.spyOn(console, "log").mockImplementation();

  await new Promise(resolve => {
    http.get({ port }, res => {
      let buffer = "";
      console.log(`Got res code: ${res.statusCode}`);

      res.setEncoding("utf8");
      res.on("data", chunk => {
        buffer += chunk;
      });

      res.on("end", () => {
        console.log(`Response ended, read ${buffer.length} bytes`);
        expect(buffer).toBe(body);
        resolve();
      });
    });
  });

  expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Got res code: \d+/));
  expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/Response ended, read \d+ bytes/));

  consoleLogSpy.mockRestore();
  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http-extra-response.js
