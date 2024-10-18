//#FILE: test-http-pipeline-requests-connection-leak.js
//#SHA1: fc3e33a724cc7a499c7716fe8af6b78e7f72e943
//-----------------
"use strict";

const http = require("http");
const net = require("net");

const big = Buffer.alloc(16 * 1024, "A");

const COUNT = 1e4;

test("HTTP pipeline requests do not cause connection leak", done => {
  let client;
  const server = http.createServer((req, res) => {
    res.end(big, () => {
      countdown.dec();
    });
  });

  const countdown = new Countdown(COUNT, () => {
    server.close();
    client.end();
    done();
  });

  server.listen(0, () => {
    const req = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n".repeat(COUNT);
    client = net.connect(server.address().port, () => {
      client.write(req);
    });
    client.resume();
  });
});

class Countdown {
  constructor(count, callback) {
    this.count = count;
    this.callback = callback;
  }

  dec() {
    this.count--;
    if (this.count === 0) {
      this.callback();
    }
  }
}

//<#END_FILE: test-http-pipeline-requests-connection-leak.js
