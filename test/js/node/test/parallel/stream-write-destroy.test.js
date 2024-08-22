//#FILE: test-stream-write-destroy.js
//#SHA1: d39354900702b56f19b37407f2e8459ca063fbd6
//-----------------
"use strict";

const { Writable } = require("stream");

// Test interaction between calling .destroy() on a writable and pending
// writes.

describe("Stream write and destroy interaction", () => {
  for (const withPendingData of [false, true]) {
    for (const useEnd of [false, true]) {
      test(`withPendingData: ${withPendingData}, useEnd: ${useEnd}`, () => {
        const callbacks = [];

        const w = new Writable({
          write(data, enc, cb) {
            callbacks.push(cb);
          },
          // Effectively disable the HWM to observe 'drain' events more easily.
          highWaterMark: 1,
        });

        let chunksWritten = 0;
        let drains = 0;
        w.on("drain", () => drains++);

        function onWrite(err) {
          if (err) {
            expect(w.destroyed).toBe(true);
            expect(err.code).toBe("ERR_STREAM_DESTROYED");
          } else {
            chunksWritten++;
          }
        }

        w.write("abc", onWrite);
        expect(chunksWritten).toBe(0);
        expect(drains).toBe(0);
        callbacks.shift()();
        expect(chunksWritten).toBe(1);
        expect(drains).toBe(1);

        if (withPendingData) {
          // Test 2 cases: There either is or is not data still in the write queue.
          // (The second write will never actually get executed either way.)
          w.write("def", onWrite);
        }
        if (useEnd) {
          // Again, test 2 cases: Either we indicate that we want to end the
          // writable or not.
          w.end("ghi", onWrite);
        } else {
          w.write("ghi", onWrite);
        }

        expect(chunksWritten).toBe(1);
        w.destroy();
        expect(chunksWritten).toBe(1);
        callbacks.shift()();
        expect(chunksWritten).toBe(useEnd && !withPendingData ? 1 : 2);
        expect(callbacks.length).toBe(0);
        expect(drains).toBe(1);
      });
    }
  }
});

//<#END_FILE: test-stream-write-destroy.js
