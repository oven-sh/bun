//#FILE: test-http-get-pipeline-problem.js
//#SHA1: 422a6c8ae8350bb70627efee734652421322b1bd
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
// In previous versions of Node.js (e.g., 0.6.0), this sort of thing would halt
// after http.globalAgent.maxSockets number of files.
// See https://groups.google.com/forum/#!topic/nodejs-dev/V5fB69hFa9o
const fixtures = require("../common/fixtures");
const http = require("http");
const fs = require("fs");
const tmpdir = require("../common/tmpdir");

http.globalAgent.maxSockets = 1;

tmpdir.refresh();

const image = fixtures.readSync("/person.jpg");

console.log(`image.length = ${image.length}`);

const total = 10;

test("HTTP GET pipeline problem", async () => {
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, {
        "content-type": "image/jpeg",
        connection: "close",
        "content-length": image.length,
      });
      res.end(image);
    }, 1);
  });

  await new Promise(resolve => server.listen(0, resolve));

  const serverAddress = server.address();

  const requests = Array.from({ length: total }, (_, i) => {
    return new Promise((resolve, reject) => {
      const opts = {
        port: serverAddress.port,
        headers: { connection: "close" },
      };

      http
        .get(opts, res => {
          console.error(`recv ${i}`);
          const s = fs.createWriteStream(`${tmpdir.path}/${i}.jpg`);
          res.pipe(s);

          s.on("finish", () => {
            console.error(`done ${i}`);
            resolve();
          });
        })
        .on("error", reject);
    });
  });

  await Promise.all(requests);

  // Check files
  const files = fs.readdirSync(tmpdir.path);
  expect(files.length).toBeGreaterThanOrEqual(total);

  for (let i = 0; i < total; i++) {
    const fn = `${i}.jpg`;
    expect(files).toContain(fn);
    const stat = fs.statSync(`${tmpdir.path}/${fn}`);
    expect(stat.size).toBe(image.length);
  }

  server.close();
});

//<#END_FILE: test-http-get-pipeline-problem.js
