//#FILE: test-dgram-connect-send-default-host.js
//#SHA1: 78d734d664f2bf2f6376846bba7c909d8253c4dc
//-----------------
"use strict";

const dgram = require("dgram");

const toSend = [Buffer.alloc(256, "x"), Buffer.alloc(256, "y"), Buffer.alloc(256, "z"), "hello"];

const received = [];

test("dgram connect and send with default host", async () => {
  const client = dgram.createSocket("udp4");
  const server = dgram.createSocket("udp4");

  const serverListening = new Promise(resolve => {
    server.on("listening", resolve);
  });

  server.on("message", (buf, info) => {
    received.push(buf.toString());

    if (received.length === toSend.length * 2) {
      // The replies may arrive out of order -> sort them before checking.
      received.sort();

      const expected = toSend.concat(toSend).map(String).sort();
      expect(received).toEqual(expected);
      client.close();
      server.close();
    }
  });

  server.bind(0);

  await serverListening;

  const port = server.address().port;
  await new Promise((resolve, reject) => {
    client.connect(port, err => {
      if (err) reject(err);
      else resolve();
    });
  });

  client.send(toSend[0], 0, toSend[0].length);
  client.send(toSend[1]);
  client.send([toSend[2]]);
  client.send(toSend[3], 0, toSend[3].length);

  client.send(new Uint8Array(toSend[0]), 0, toSend[0].length);
  client.send(new Uint8Array(toSend[1]));
  client.send([new Uint8Array(toSend[2])]);
  client.send(new Uint8Array(Buffer.from(toSend[3])), 0, toSend[3].length);

  // Wait for all messages to be received
  await new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (received.length === toSend.length * 2) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });

  expect(received.length).toBe(toSend.length * 2);
});

//<#END_FILE: test-dgram-connect-send-default-host.js
