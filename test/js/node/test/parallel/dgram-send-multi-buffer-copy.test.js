//#FILE: test-dgram-send-multi-buffer-copy.js
//#SHA1: 6adf8291a5dd40cb6a71ad3779f0d26d2150249a
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

test("dgram send multi buffer copy", done => {
  const onMessage = jest.fn((err, bytes) => {
    expect(bytes).toBe(buf1.length + buf2.length);
  });

  const buf1 = Buffer.alloc(256, "x");
  const buf2 = Buffer.alloc(256, "y");

  client.on("listening", function () {
    const toSend = [buf1, buf2];
    client.send(toSend, this.address().port, "127.0.0.1", onMessage);
    toSend.splice(0, 2);
  });

  client.on("message", (buf, info) => {
    const expected = Buffer.concat([buf1, buf2]);
    expect(buf.equals(expected)).toBe(true);
    expect(onMessage).toHaveBeenCalledTimes(1);
    done();
  });

  client.bind(0);
});

//<#END_FILE: test-dgram-send-multi-buffer-copy.js
