//#FILE: test-http-no-read-no-dump.js
//#SHA1: 8548eb47a6eb8ec151b9c60e74b026d983145d26
//-----------------
"use strict";

const http = require("http");

let onPause = null;

describe("HTTP no read no dump", () => {
  let server;
  let port;

  beforeAll(done => {
    server = http
      .createServer((req, res) => {
        if (req.method === "GET") return res.end();

        res.writeHead(200);
        res.flushHeaders();

        req.on("close", () => {
          expect(() => {
            req.on("end", () => {});
          }).not.toThrow();
        });

        req.connection.on("pause", () => {
          res.end();
          onPause();
        });
      })
      .listen(0, () => {
        port = server.address().port;
        done();
      });
  });

  afterAll(done => {
    server.close(done);
  });

  test("should handle POST and GET requests correctly", done => {
    const agent = new http.Agent({
      maxSockets: 1,
      keepAlive: true,
    });

    const post = http.request(
      {
        agent,
        method: "POST",
        port,
      },
      res => {
        res.resume();

        post.write(Buffer.alloc(64 * 1024).fill("X"));
        onPause = () => {
          post.end("something");
        };
      },
    );

    // What happens here is that the server `end`s the response before we send
    // `something`, and the client thought that this is a green light for sending
    // next GET request
    post.write("initial");

    http
      .request(
        {
          agent,
          method: "GET",
          port,
        },
        res => {
          res.connection.end();
          done();
        },
      )
      .end();
  });
});

//<#END_FILE: test-http-no-read-no-dump.js
