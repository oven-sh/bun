//#FILE: test-dgram-connect-send-empty-packet.js
//#SHA1: 107d20a1e7a2628097091471ffdad75fc714b1fb
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram connect and send empty packet", done => {
  const client = dgram.createSocket("udp4");

  client.bind(0, () => {
    expect.hasAssertions();
    client.connect(client.address().port, () => {
      client.on("message", callback);
      const buf = Buffer.alloc(1);

      const interval = setInterval(() => {
        client.send(buf, 0, 0, callback);
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
});

//<#END_FILE: test-dgram-connect-send-empty-packet.js
