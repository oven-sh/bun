//#FILE: test-http-client-keep-alive-release-before-finish.js
//#SHA1: 198cd4a6c28c8a7dda45f003305e8fa80f05469d
//-----------------
"use strict";

const http = require("http");

test("HTTP client keep-alive release before finish", done => {
  const server = http.createServer((req, res) => {
    res.end();
  });

  server.listen(0, () => {
    const agent = new http.Agent({
      maxSockets: 1,
      keepAlive: true,
    });

    const port = server.address().port;

    const post = http.request(
      {
        agent,
        method: "POST",
        port,
      },
      res => {
        res.resume();
      },
    );

    // What happens here is that the server `end`s the response before we send
    // `something`, and the client thought that this is a green light for sending
    // next GET request
    post.write(Buffer.alloc(16 * 1024, "X"));
    setTimeout(() => {
      post.end("something");
    }, 100);

    http
      .request(
        {
          agent,
          method: "GET",
          port,
        },
        res => {
          server.close();
          res.connection.end();
          done();
        },
      )
      .end();
  });
});

//<#END_FILE: test-http-client-keep-alive-release-before-finish.js
