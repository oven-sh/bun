//#FILE: test-http2-reset-flood.js
//#SHA1: bbc187d4b44e6634e1ad46d7a6425591161e85da
//-----------------
"use strict";

const http2 = require("http2");
const net = require("net");

// Check if crypto is available
let hasCrypto = false;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  // Crypto not available
}

// Skip the test if crypto is not available
(hasCrypto ? describe : describe.skip)("HTTP/2 reset flood", () => {
  let server;
  let serverPort;

  beforeAll(async () => {
    server = http2.createServer({ maxSessionInvalidFrames: 100 });
    server.on("stream", stream => {
      stream.respond({
        "content-type": "text/plain",
        ":status": 200,
      });
      stream.end("Hello, world!\n");
    });

    await new Promise(resolve => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test("Creating invalid HTTP/2 streams should eventually close the session", async () => {
    const h2header = Buffer.alloc(9);
    const conn = net.connect({ port: serverPort, allowHalfOpen: true });

    await new Promise(resolve => conn.on("connect", resolve));

    conn.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

    h2header[3] = 4; // Send a settings frame.
    conn.write(Buffer.from(h2header));

    let inbuf = Buffer.alloc(0);
    let state = "settingsHeader";
    let settingsFrameLength;

    const dataPromise = new Promise(resolve => {
      conn.on("data", chunk => {
        inbuf = Buffer.concat([inbuf, chunk]);
        switch (state) {
          case "settingsHeader":
            if (inbuf.length < 9) return;
            settingsFrameLength = inbuf.readIntBE(0, 3);
            inbuf = inbuf.slice(9);
            state = "readingSettings";
          // Fallthrough
          case "readingSettings":
            if (inbuf.length < settingsFrameLength) return;
            inbuf = inbuf.slice(settingsFrameLength);
            h2header[3] = 4; // Send a settings ACK.
            h2header[4] = 1;
            conn.write(Buffer.from(h2header));
            state = "ignoreInput";
            writeRequests();
            break;
        }
      });
    });

    let gotError = false;
    let streamId = 1;

    function writeRequests() {
      for (let i = 1; i < 10 && !gotError; i++) {
        h2header[3] = 1; // HEADERS
        h2header[4] = 0x5; // END_HEADERS|END_STREAM
        h2header.writeIntBE(1, 0, 3); // Length: 1
        h2header.writeIntBE(streamId, 5, 4); // Stream ID
        streamId += 2;
        // 0x88 = :status: 200
        if (!conn.write(Buffer.concat([h2header, Buffer.from([0x88])]))) {
          break;
        }
      }
      if (!gotError) setImmediate(writeRequests);
    }

    const errorPromise = new Promise(resolve => {
      conn.once("error", err => {
        gotError = true;
        resolve(err);
      });
    });

    const error = await errorPromise;
    expect(error).toBeTruthy();
    conn.destroy();
  });
});

//<#END_FILE: test-http2-reset-flood.js
