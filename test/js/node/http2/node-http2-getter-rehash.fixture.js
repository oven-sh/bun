"use strict";
// Re-entrant session.request() from a user options getter. request() shallow
// copies options before the native call, so the getter runs while the outer
// stream is being set up and the inner requests force the streams HashMap to
// rehash. Streams are heap-allocated, so no *Stream into the map's backing
// storage should dangle.

const http2 = require("node:http2");

const server = http2.createServer();
server.on("stream", stream => {
  stream.respond({ ":status": 200 });
  stream.end();
});
server.on("error", () => {});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const client = http2.connect("http://127.0.0.1:" + port);
  client.on("error", () => {});

  client.on("connect", () => {
    let triggered = false;

    const options = {
      get paddingStrategy() {
        if (!triggered) {
          triggered = true;
          // Insert enough new streams to force the HashMap to rehash while the
          // outer request() is still on the stack.
          for (let i = 0; i < 32; i++) {
            const r = client.request({ ":path": "/", ":method": "GET" });
            r.on("error", () => {});
            r.on("response", () => {});
            r.resume();
          }
        }
        return 0;
      },
      exclusive: true,
      waitForTrailers: false,
      endStream: true,
    };

    const req = client.request({ ":path": "/", ":method": "POST" }, options);
    req.on("error", () => {});
    req.on("response", () => {});
    req.resume();
    req.on("close", () => {
      client.close(() => {
        server.close(() => {
          if (!triggered) {
            console.error("getter was never invoked");
            process.exit(1);
          }
          console.log("done");
          process.exit(0);
        });
      });
    });
    req.end();
  });
});
