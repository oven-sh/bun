//#FILE: test-stream-readable-readable-then-resume.js
//#SHA1: 79790a4cd766421a6891704bf157072eaef2d5b4
//-----------------
"use strict";

const { Readable } = require("stream");

// This test verifies that a stream could be resumed after
// removing the readable event in the same tick

function check(s) {
  const readableListener = jest.fn();
  s.on("readable", readableListener);
  s.on("end", jest.fn());
  expect(s.removeListener).toBe(s.off);
  s.removeListener("readable", readableListener);
  s.resume();

  expect(readableListener).not.toHaveBeenCalled();
}

test("Readable stream can be resumed after removing readable event", () => {
  const s = new Readable({
    objectMode: true,
    highWaterMark: 1,
    read() {
      if (!this.first) {
        this.push("hello");
        this.first = true;
        return;
      }

      this.push(null);
    },
  });

  check(s);
});

//<#END_FILE: test-stream-readable-readable-then-resume.js
