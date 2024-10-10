//#FILE: test-dgram-send-callback-recursive.js
//#SHA1: fac7c8b29bd2122d4de273c54128b5a6100ad437
//-----------------
"use strict";

const dgram = require("dgram");

let received = 0;
let sent = 0;
const limit = 10;
let async = false;
let port;
const chunk = "abc";

test("dgram send callback recursive", done => {
  const client = dgram.createSocket("udp4");

  function onsend() {
    if (sent++ < limit) {
      client.send(chunk, 0, chunk.length, port, "127.0.0.1", onsend);
    } else {
      expect(async).toBe(true);
    }
  }

  client.on("listening", function () {
    port = this.address().port;

    process.nextTick(() => {
      async = true;
    });

    onsend();
  });

  client.on("message", (buf, info) => {
    received++;
    if (received === limit) {
      client.close();
    }
  });

  client.on("close", () => {
    expect(received).toBe(limit);
    done();
  });

  client.bind(0);
});

//<#END_FILE: test-dgram-send-callback-recursive.js
