//#FILE: test-dgram-connect-send-empty-array.js
//#SHA1: 81de5b211c0e3be3158d2c06178577f39e62f0d1
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram.connect() and send empty array", () => {
  const client = dgram.createSocket("udp4");

  expect.assertions(1);

  return new Promise(resolve => {
    client.on("message", (buf, info) => {
      const expected = Buffer.alloc(0);
      expect(buf).toEqual(expected);
      client.close();
      resolve();
    });

    client.on("listening", () => {
      client.connect(client.address().port, "127.0.0.1", () => client.send([]));
    });

    client.bind(0);
  });
});

//<#END_FILE: test-dgram-connect-send-empty-array.js
