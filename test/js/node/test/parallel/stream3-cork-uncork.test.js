//#FILE: test-stream3-cork-uncork.js
//#SHA1: d1cc0d9e9be4ae657ab2db8e02589ac485268c63
//-----------------
"use strict";

const stream = require("stream");
const Writable = stream.Writable;

// Test the buffering behavior of Writable streams.
//
// The call to cork() triggers storing chunks which are flushed
// on calling uncork() in the same tick.
//
// node version target: 0.12

describe("Writable stream cork and uncork", () => {
  const expectedChunks = ["please", "buffer", "me", "kindly"];
  let inputChunks;
  let seenChunks;
  let seenEnd;
  let w;

  beforeEach(() => {
    inputChunks = expectedChunks.slice(0);
    seenChunks = [];
    seenEnd = false;

    w = new Writable();
    // Let's arrange to store the chunks.
    w._write = function (chunk, encoding, cb) {
      // Default encoding given none was specified.
      expect(encoding).toBe("buffer");

      seenChunks.push(chunk);
      cb();
    };
    // Let's record the stream end event.
    w.on("finish", () => {
      seenEnd = true;
    });
  });

  function writeChunks(remainingChunks) {
    return new Promise(resolve => {
      function write() {
        const writeChunk = remainingChunks.shift();
        if (writeChunk) {
          setImmediate(() => {
            const writeState = w.write(writeChunk);
            // We were not told to stop writing.
            expect(writeState).toBe(true);
            write();
          });
        } else {
          resolve();
        }
      }
      write();
    });
  }

  test("initial write is immediate", () => {
    w.write("stuff");
    // The write was immediate.
    expect(seenChunks.length).toBe(1);
  });

  test("cork buffers writes and uncork flushes", async () => {
    // Reset the chunks seen so far.
    seenChunks = [];

    // Trigger stream buffering.
    w.cork();

    // Write the bufferedChunks.
    await writeChunks(inputChunks);

    // Should not have seen anything yet.
    expect(seenChunks.length).toBe(0);

    // Trigger writing out the buffer.
    w.uncork();

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

    await new Promise(resolve => setImmediate(resolve));
    // The stream should not have been ended.
    expect(seenEnd).toBe(false);
  });
});

//<#END_FILE: test-stream3-cork-uncork.js
