//#FILE: test-http-outgoing-finished.js
//#SHA1: 9c1ce8205b113dbb5b4ddfd06c0c90017b344e15
//-----------------
"use strict";

const http = require("http");
const { finished } = require("stream");

let server;

beforeAll(() => {
  return new Promise(resolve => {
    server = http
      .createServer((req, res) => {
        let closed = false;
        res
          .on("close", () => {
            closed = true;
            finished(res, () => {
              server.close();
            });
          })
          .end();
        finished(res, () => {
          expect(closed).toBe(true);
        });
      })
      .listen(0, () => {
        resolve();
      });
  });
});

afterAll(() => {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
  });
});

test("HTTP outgoing finished", done => {
  const closeHandler = jest.fn();
  const finishedHandler = jest.fn();

  server.on("request", (req, res) => {
    res.on("close", closeHandler);
    finished(res, finishedHandler);
  });

  http
    .request({
      port: server.address().port,
      method: "GET",
    })
    .on("response", res => {
      res.resume();
    })
    .end();

  setTimeout(() => {
    expect(closeHandler).toHaveBeenCalledTimes(1);
    expect(finishedHandler).toHaveBeenCalledTimes(1);
    done();
  }, 1000);
});

//<#END_FILE: test-http-outgoing-finished.js
