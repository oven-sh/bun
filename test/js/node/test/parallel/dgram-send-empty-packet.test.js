//#FILE: test-dgram-send-empty-packet.js
//#SHA1: f39fb8a7245893f0f6f55aeb110d458e2f265013
//-----------------
"use strict";

const dgram = require("dgram");

test("send empty packet", done => {
  const client = dgram.createSocket("udp4");

  client.bind(0, () => {
    client.on("message", jest.fn(callback));

    const port = client.address().port;
    const buf = Buffer.alloc(1);

    const interval = setInterval(() => {
      client.send(buf, 0, 0, port, "127.0.0.1", jest.fn(callback));
    }, 10);

    function callback(firstArg) {
      // If client.send() callback, firstArg should be null.
      // If client.on('message') listener, firstArg should be a 0-length buffer.
      if (firstArg instanceof Buffer) {
        expect(firstArg.length).toBe(0);
        clearInterval(interval);
        client.close();
        done();
      }
    }
  });
});

//<#END_FILE: test-dgram-send-empty-packet.js
