//#FILE: test-stream3-cork-end.js
//#SHA1: 1ac6a2589bee41bc1e9e08ef308bcae3cd999106
//-----------------
"use strict";

const stream = require("stream");
const Writable = stream.Writable;

// Test the buffering behavior of Writable streams.
//
// The call to cork() triggers storing chunks which are flushed
// on calling end() and the stream subsequently ended.
//
// node version target: 0.12

test("Writable stream buffering behavior with cork() and end()", done => {
  const expectedChunks = ["please", "buffer", "me", "kindly"];
  const inputChunks = expectedChunks.slice(0);
  let seenChunks = [];
  let seenEnd = false;

  const w = new Writable();
  // Let's arrange to store the chunks.
  w._write = function (chunk, encoding, cb) {
    // Stream end event is not seen before the last write.
    expect(seenEnd).toBe(false);
    // Default encoding given none was specified.
    expect(encoding).toBe("buffer");

    seenChunks.push(chunk);
    cb();
  };
  // Let's record the stream end event.
  w.on("finish", () => {
    seenEnd = true;
  });

  function writeChunks(remainingChunks, callback) {
    const writeChunk = remainingChunks.shift();
    let writeState;

    if (writeChunk) {
      setImmediate(() => {
        writeState = w.write(writeChunk);
        // We were not told to stop writing.
        expect(writeState).toBe(true);

        writeChunks(remainingChunks, callback);
      });
    } else {
      callback();
    }
  }

  // Do an initial write.
  w.write("stuff");
  // The write was immediate.
  expect(seenChunks.length).toBe(1);
  // Reset the seen chunks.
  seenChunks = [];

  // Trigger stream buffering.
  w.cork();

  // Write the bufferedChunks.
  writeChunks(inputChunks, () => {
    // Should not have seen anything yet.
    expect(seenChunks.length).toBe(0);

    // Trigger flush and ending the stream.
    w.end();

    // Stream should not ended in current tick.
    expect(seenEnd).toBe(false);

    // Buffered bytes should be seen in current tick.
    expect(seenChunks.length).toBe(4);

    // Did the chunks match.
    for (let i = 0, l = expectedChunks.length; i < l; i++) {
      const seen = seenChunks[i];
      // There was a chunk.
      expect(seen).toBeTruthy();

      const expected = Buffer.from(expectedChunks[i]);
      // It was what we expected.
      expect(seen.equals(expected)).toBe(true);
    }

    setImmediate(() => {
      // Stream should have ended in next tick.
      expect(seenEnd).toBe(true);
      done();
    });
  });
});

//<#END_FILE: test-stream3-cork-end.js
