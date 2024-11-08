//#FILE: test-net-large-string.js
//#SHA1: d823932009345f5d651ca02b7ddbba67057a423b
//-----------------
"use strict";
const net = require("net");

const kPoolSize = 40 * 1024;
const data = "あ".repeat(kPoolSize);
const encoding = "UTF-8";

test("net large string", done => {
  const server = net.createServer(socket => {
    let receivedSize = 0;
    socket.setEncoding(encoding);
    socket.on("data", chunk => {
      receivedSize += chunk.length;
    });
    socket.on("end", () => {
      expect(receivedSize).toBe(kPoolSize);
      socket.end();
    });
  });

  server.listen(0, () => {
    // we connect to the server using 127.0.0.1 to avoid happy eyeballs
    const client = net.createConnection(server.address().port, "127.0.0.1");
    client.on("end", () => {
      server.close();
      done();
    });
    client.write(data, encoding);
    client.end();
  });
});

//<#END_FILE: test-net-large-string.js
