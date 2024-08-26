//#FILE: test-tcp-wrap-connect.js
//#SHA1: cc302b52d997beac187400587ce2dffc0978a7da
//-----------------
"use strict";

const net = require("net");

let connectCount = 0;
let endCount = 0;
let shutdownCount = 0;

function makeConnection(server) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(server.address().port, "127.0.0.1", () => {
      expect(client.readable).toBe(true);
      expect(client.writable).toBe(true);

      client.end(() => {
        shutdownCount++;
        client.destroy();
        resolve();
      });
    });

    client.on("error", reject);
  });
}

test("TCP connection and shutdown", async () => {
  const server = net.createServer(socket => {
    connectCount++;
    socket.resume();
    socket.on("end", () => {
      endCount++;
      socket.destroy();
      server.close();
    });
  });

  await new Promise(resolve => server.listen(0, resolve));

  await makeConnection(server);

  await new Promise(resolve => server.on("close", resolve));

  expect(shutdownCount).toBe(1);
  expect(connectCount).toBe(1);
  expect(endCount).toBe(1);
});

//<#END_FILE: test-tcp-wrap-connect.js
