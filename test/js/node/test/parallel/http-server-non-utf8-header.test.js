//#FILE: test-http-server-non-utf8-header.js
//#SHA1: bc84accb29cf80323d0fb55455a596f36a7933b2
//-----------------
"use strict";
const http = require("http");

const nonUtf8Header = "bår";
const nonUtf8ToLatin1 = Buffer.from(nonUtf8Header).toString("latin1");

test("HTTP server with non-UTF8 header", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, ["content-disposition", Buffer.from(nonUtf8Header).toString("binary")]);
    res.end("hello");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get({ port: server.address().port }, res => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-disposition"]).toBe(nonUtf8ToLatin1);
        res.resume().on("end", () => {
          server.close(resolve);
        });
      });
    });
  });
});

test("HTTP server with multi-value non-UTF8 header", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, ["content-disposition", [Buffer.from(nonUtf8Header).toString("binary")]]);
    res.end("hello");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get({ port: server.address().port }, res => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-disposition"]).toBe(nonUtf8ToLatin1);
        res.resume().on("end", () => {
          server.close(resolve);
        });
      });
    });
  });
});

test("HTTP server with non-UTF8 header and Content-Length", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, ["Content-Length", "5", "content-disposition", Buffer.from(nonUtf8Header).toString("binary")]);
    res.end("hello");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      http.get({ port: server.address().port }, res => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-disposition"]).toBe(nonUtf8ToLatin1);
        res.resume().on("end", () => {
          server.close(resolve);
        });
      });
    });
  });
});

//<#END_FILE: test-http-server-non-utf8-header.js
