//#FILE: test-http-client-res-destroyed.js
//#SHA1: 9a7e890355cecb3eb88b6963b0c37df3f01bc8d7
//-----------------
"use strict";

const http = require("http");

describe("HTTP Client Response Destroyed", () => {
  test("Response destruction after manually calling destroy()", async () => {
    const server = http.createServer((req, res) => {
      res.end("asd");
    });

    await new Promise(resolve => {
      server.listen(0, () => {
        http.get(
          {
            port: server.address().port,
          },
          res => {
            expect(res.destroyed).toBe(false);
            res.destroy();
            expect(res.destroyed).toBe(true);
            res.on("close", () => {
              server.close(resolve);
            });
          },
        );
      });
    });
  });

  test("Response destruction after end of response", async () => {
    const server = http.createServer((req, res) => {
      res.end("asd");
    });

    await new Promise(resolve => {
      server.listen(0, () => {
        http.get(
          {
            port: server.address().port,
          },
          res => {
            expect(res.destroyed).toBe(false);
            res
              .on("close", () => {
                expect(res.destroyed).toBe(true);
                server.close(resolve);
              })
              .resume();
          },
        );
      });
    });
  });
});

//<#END_FILE: test-http-client-res-destroyed.js
