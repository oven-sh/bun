//#FILE: test-dgram-connect-send-empty-buffer.js
//#SHA1: 08e8b667af8e6f97e6df2c95360a3a3aec05d435
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram connect and send empty buffer", done => {
  const client = dgram.createSocket("udp4");

  client.bind(0, () => {
    const port = client.address().port;
    client.connect(port, () => {
      const buf = Buffer.alloc(0);
      client.send(buf, 0, 0, err => {
        expect(err).toBeNull();
      });
    });

    client.on("message", buffer => {
      expect(buffer.length).toBe(0);
      client.close();
      done();
    });
  });
});

//<#END_FILE: test-dgram-connect-send-empty-buffer.js
