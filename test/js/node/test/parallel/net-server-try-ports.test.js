//#FILE: test-net-server-try-ports.js
//#SHA1: 8f3f2a7c0fcc9b76f2aaf8ac2bb00c81e6a752fa
//-----------------
"use strict";

const net = require("net");

test("Server should handle EADDRINUSE and bind to another port", done => {
  const server1 = new net.Server();
  const server2 = new net.Server();

  server2.on("error", e => {
    expect(e.code).toBe("EADDRINUSE");

    server2.listen(0, () => {
      server1.close();
      server2.close();
      done();
    });
  });

  server1.listen(0, () => {
    // This should make server2 emit EADDRINUSE
    server2.listen(server1.address().port);
  });
});

//<#END_FILE: test-net-server-try-ports.js
