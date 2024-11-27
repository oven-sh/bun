//#FILE: test-net-bind-twice.js
//#SHA1: 432eb9529d0affc39c8af9ebc1147528d96305c9
//-----------------
"use strict";
const net = require("net");

test("net.Server should not allow binding to the same port twice", done => {
  const server1 = net.createServer(() => {
    throw new Error("Server1 should not receive connections");
  });

  const options = {
    reusePort: true,
    port: 0,
    host: "127.0.0.1",
  };
  server1.listen(options, () => {
    const server2 = net.createServer(() => {
      throw new Error("Server2 should not receive connections");
    });

    const port = server1.address().port;
    server2.listen({ ...options, port }, () => {
      server1.close(() => {
        done();
      });
    });

    server2.on("error", e => {
      server1.close(() => {
        done(e);
      });
    });
  });
}, 100000);

//<#END_FILE: test-net-bind-twice.js
