//#FILE: test-net-throttle.js
//#SHA1: 5c09d0b1c174ba1f88acae8d731c039ae7c3fc99
//-----------------
"use strict";

const net = require("net");
const { debuglog } = require("util");

const debug = debuglog("test");

let chars_recved = 0;
let npauses = 0;
let totalLength = 0;
let server;

beforeAll(done => {
  server = net.createServer(connection => {
    const body = "C".repeat(1024);
    let n = 1;
    debug("starting write loop");
    while (connection.write(body)) {
      n++;
    }
    debug("ended write loop");
    // Now that we're throttled, do some more writes to make sure the data isn't
    // lost.
    connection.write(body);
    connection.write(body);
    n += 2;
    totalLength = n * body.length;
    expect(connection.bufferSize).toBeGreaterThanOrEqual(0);
    expect(connection.writableLength).toBeLessThanOrEqual(totalLength);
    connection.end();
  });

  server.listen(0, () => {
    debug(`server started on port ${server.address().port}`);
    done();
  });
});

afterAll(done => {
  server.close(done);
});

test("net throttle", done => {
  const port = server.address().port;
  let paused = false;
  const client = net.createConnection(port, "127.0.0.1");
  client.setEncoding("ascii");

  client.on("data", d => {
    chars_recved += d.length;
    debug(`got ${chars_recved}`);
    if (!paused) {
      client.pause();
      npauses += 1;
      paused = true;
      debug("pause");
      const x = chars_recved;
      setTimeout(() => {
        expect(chars_recved).toBe(x);
        client.resume();
        debug("resume");
        paused = false;
      }, 100);
    }
  });

  client.on("end", () => {
    client.end();
    expect(chars_recved).toBe(totalLength);
    expect(npauses).toBeGreaterThan(1);
    done();
  });
});

//<#END_FILE: test-net-throttle.js
