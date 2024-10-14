//#FILE: test-http2-createwritereq.js
//#SHA1: 8b0d2399fb8a26ce6cc76b9f338be37a7ff08ca5
//-----------------
"use strict";

const http2 = require("http2");

// Mock the gc function
global.gc = jest.fn();

const testString = "a\u00A1\u0100\uD83D\uDE00";

const encodings = {
  // "buffer": "utf8",
  "ascii": "ascii",
  // "latin1": "latin1",
  // "binary": "latin1",
  // "utf8": "utf8",
  // "utf-8": "utf8",
  // "ucs2": "ucs2",
  // "ucs-2": "ucs2",
  // "utf16le": "ucs2",
  // "utf-16le": "ucs2",
  // "UTF8": "utf8",
};

describe("http2 createWriteReq", () => {
  let server;
  let serverAddress;

  beforeAll(done => {
    server = http2.createServer((req, res) => {
      const testEncoding = encodings[req.url.slice(1)];

      req.on("data", chunk => {
        // console.error(testEncoding, chunk, Buffer.from(testString, testEncoding));
        expect(Buffer.from(testString, testEncoding).equals(chunk)).toBe(true);
      });

      req.on("end", () => res.end());
    });

    server.listen(0, () => {
      serverAddress = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  Object.keys(encodings).forEach(writeEncoding => {
    test(`should handle ${writeEncoding} encoding`, done => {
      const client = http2.connect(serverAddress);
      const req = client.request({
        ":path": `/${writeEncoding}`,
        ":method": "POST",
      });

      expect(req._writableState.decodeStrings).toBe(false);

      req.write(
        writeEncoding !== "buffer" ? testString : Buffer.from(testString),
        writeEncoding !== "buffer" ? writeEncoding : undefined,
      );
      req.resume();

      req.on("end", () => {
        client.close();
        done();
      });

      // Ref: https://github.com/nodejs/node/issues/17840
      const origDestroy = req.destroy;
      req.destroy = function (...args) {
        // Schedule a garbage collection event at the end of the current
        // MakeCallback() run.
        process.nextTick(global.gc);
        return origDestroy.call(this, ...args);
      };

      req.end();
    });
  });
});

//<#END_FILE: test-http2-createwritereq.test.js
