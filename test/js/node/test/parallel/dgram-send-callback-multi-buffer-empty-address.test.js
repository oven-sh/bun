//#FILE: test-dgram-send-callback-multi-buffer-empty-address.js
//#SHA1: 61d00ee31b25f144989e0d3ced884a70f4e7d07a
//-----------------
"use strict";

const dgram = require("dgram");

let client;

beforeEach(() => {
  client = dgram.createSocket("udp4");
});

afterEach(() => {
  client.close();
});

test("send callback multi buffer empty address", done => {
  const buf1 = Buffer.alloc(256, "x");
  const buf2 = Buffer.alloc(256, "y");

  client.on("listening", function () {
    const port = this.address().port;
    client.send([buf1, buf2], port, (err, bytes) => {
      expect(err).toBeNull();
      expect(bytes).toBe(buf1.length + buf2.length);
    });
  });

  client.on("message", buf => {
    const expected = Buffer.concat([buf1, buf2]);
    expect(buf.equals(expected)).toBe(true);
    done();
  });

  client.bind(0);
});

//<#END_FILE: test-dgram-send-callback-multi-buffer-empty-address.js
