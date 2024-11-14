//#FILE: test-dgram-send-callback-buffer-empty-address.js
//#SHA1: 5c76ad150693dcec8921099fa994f61aa783713c
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram send callback with buffer and empty address", done => {
  const client = dgram.createSocket("udp4");

  const buf = Buffer.alloc(256, "x");

  const onMessage = jest.fn(bytes => {
    expect(bytes).toBe(buf.length);
    client.close();
    done();
  });

  client.bind(0, () => {
    client.send(buf, client.address().port, error => {
      expect(error).toBeFalsy();
      onMessage(buf.length);
    });
  });
});

//<#END_FILE: test-dgram-send-callback-buffer-empty-address.js
