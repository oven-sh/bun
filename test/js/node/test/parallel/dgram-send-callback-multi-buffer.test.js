//#FILE: test-dgram-send-callback-multi-buffer.js
//#SHA1: 622d513f7897c216601b50a2960a8a36259b2595
//-----------------
"use strict";

const dgram = require("dgram");

test("dgram send callback with multiple buffers", done => {
  const client = dgram.createSocket("udp4");

  const messageSent = jest.fn((err, bytes) => {
    expect(err).toBeNull();
    expect(bytes).toBe(buf1.length + buf2.length);
  });

  const buf1 = Buffer.alloc(256, "x");
  const buf2 = Buffer.alloc(256, "y");

  client.on("listening", () => {
    const port = client.address().port;
    client.send([buf1, buf2], port, "localhost", messageSent);
  });

  client.on("message", (buf, info) => {
    const expected = Buffer.concat([buf1, buf2]);
    expect(buf.equals(expected)).toBe(true);
    expect(messageSent).toHaveBeenCalledTimes(1);
    client.close();
    done();
  });

  client.bind(0);
});

//<#END_FILE: test-dgram-send-callback-multi-buffer.js
