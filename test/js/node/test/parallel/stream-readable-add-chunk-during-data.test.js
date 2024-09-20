//#FILE: test-stream-readable-add-chunk-during-data.js
//#SHA1: f34525f5ea022c837ba1e40e98b1b41da5df50b2
//-----------------
"use strict";
const { Readable } = require("stream");

// Verify that .push() and .unshift() can be called from 'data' listeners.

["push", "unshift"].forEach(method => {
  test(`Readable ${method} can be called from 'data' listeners`, done => {
    const r = new Readable({ read() {} });

    r.once("data", chunk => {
      expect(r.readableLength).toBe(0);
      r[method](chunk);
      expect(r.readableLength).toBe(chunk.length);

      r.on("data", newChunk => {
        expect(newChunk.toString()).toBe("Hello, world");
        done();
      });
    });

    r.push("Hello, world");
  });
});

//<#END_FILE: test-stream-readable-add-chunk-during-data.js
