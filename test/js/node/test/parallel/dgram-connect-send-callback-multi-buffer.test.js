//#FILE: test-dgram-connect-send-callback-multi-buffer.js
//#SHA1: f30fbed996bbcd2adb268e9e3412a5f83119f8ae
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram connect send callback multi buffer", done => {
  const client = dgram.createSocket("udp4");

  const messageSent = jest.fn((err, bytes) => {
    expect(bytes).toBe(buf1.length + buf2.length);
  });

  const buf1 = Buffer.alloc(256, "x");
  const buf2 = Buffer.alloc(256, "y");

  client.on("listening", () => {
    const port = client.address().port;
    client.connect(port, () => {
      client.send([buf1, buf2], messageSent);
    });
  });

  client.on("message", (buf, info) => {
    const expected = Buffer.concat([buf1, buf2]);
    expect(buf.equals(expected)).toBe(true);
    client.close();
    expect(messageSent).toHaveBeenCalledTimes(1);
    done();
  });

  client.bind(0);
});

//<#END_FILE: test-dgram-connect-send-callback-multi-buffer.js
