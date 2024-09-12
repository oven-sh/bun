//#FILE: test-http-client-upload.js
//#SHA1: 328a7e9989cc28daa5996c83fe9e3cfcb0893e01
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

test("HTTP client upload", async () => {
  const serverHandler = jest.fn((req, res) => {
    expect(req.method).toBe("POST");
    req.setEncoding("utf8");

    let sent_body = "";

    req.on("data", chunk => {
      console.log(`server got: ${JSON.stringify(chunk)}`);
      sent_body += chunk;
    });

    req.on("end", () => {
      expect(sent_body).toBe("1\n2\n3\n");
      console.log("request complete from server");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("hello\n");
      res.end();
    });
  });

  const server = http.createServer(serverHandler);
  await new Promise(resolve => server.listen(0, resolve));

  const { port } = server.address();

  const clientHandler = jest.fn(res => {
    res.setEncoding("utf8");
    res.on("data", chunk => {
      console.log(chunk);
    });
    res.on("end", () => {
      server.close();
    });
  });

  const req = http.request(
    {
      port,
      method: "POST",
      path: "/",
    },
    clientHandler,
  );

  req.write("1\n");
  req.write("2\n");
  req.write("3\n");
  req.end();

  await new Promise(resolve => server.on("close", resolve));

  expect(serverHandler).toHaveBeenCalledTimes(1);
  expect(clientHandler).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-http-client-upload.js
