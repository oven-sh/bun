//#FILE: test-stream-unshift-read-race.js
//#SHA1: 3b6a1e1b0ae4b58251211a49cd8171569cfd86ed
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const stream = require("stream");

// This test verifies that:
// 1. unshift() does not cause colliding _read() calls.
// 2. unshift() after the 'end' event is an error, but after the EOF
//    signalling null, it is ok, and just creates a new readable chunk.
// 3. push() after the EOF signaling null is an error.
// 4. _read() is not called after pushing the EOF null chunk.

test("stream unshift read race", done => {
  const hwm = 10;
  const r = stream.Readable({ highWaterMark: hwm, autoDestroy: false });
  const chunks = 10;

  const data = Buffer.allocUnsafe(chunks * hwm + Math.ceil(hwm / 2));
  for (let i = 0; i < data.length; i++) {
    const c = "asdf".charCodeAt(i % 4);
    data[i] = c;
  }

  let pos = 0;
  let pushedNull = false;
  r._read = function (n) {
    expect(pushedNull).toBe(false);

    // Every third chunk is fast
    push(!(chunks % 3));

    function push(fast) {
      expect(pushedNull).toBe(false);
      const c = pos >= data.length ? null : data.slice(pos, pos + n);
      pushedNull = c === null;
      if (fast) {
        pos += n;
        r.push(c);
        if (c === null) pushError();
      } else {
        setTimeout(function () {
          pos += n;
          r.push(c);
          if (c === null) pushError();
        }, 1);
      }
    }
  };

  function pushError() {
    r.unshift(Buffer.allocUnsafe(1));
    w.end();

    expect(() => {
      r.push(Buffer.allocUnsafe(1));
    }).toThrow(
      expect.objectContaining({
        code: "ERR_STREAM_PUSH_AFTER_EOF",
        name: "Error",
        message: expect.any(String),
      }),
    );
  }

  const w = stream.Writable();
  const written = [];
  w._write = function (chunk, encoding, cb) {
    written.push(chunk.toString());
    cb();
  };

  r.on("end", () => {
    throw new Error("end event should not be emitted");
  });

  r.on("readable", function () {
    let chunk;
    while (null !== (chunk = r.read(10))) {
      w.write(chunk);
      if (chunk.length > 4) r.unshift(Buffer.from("1234"));
    }
  });

  w.on("finish", () => {
    // Each chunk should start with 1234, and then be asfdasdfasdf...
    // The first got pulled out before the first unshift('1234'), so it's
    // lacking that piece.
    expect(written[0]).toBe("asdfasdfas");
    let asdf = "d";
    console.error(`0: ${written[0]}`);
    for (let i = 1; i < written.length; i++) {
      console.error(`${i.toString(32)}: ${written[i]}`);
      expect(written[i].slice(0, 4)).toBe("1234");
      for (let j = 4; j < written[i].length; j++) {
        const c = written[i].charAt(j);
        expect(c).toBe(asdf);
        switch (asdf) {
          case "a":
            asdf = "s";
            break;
          case "s":
            asdf = "d";
            break;
          case "d":
            asdf = "f";
            break;
          case "f":
            asdf = "a";
            break;
        }
      }
    }
    expect(written).toHaveLength(18);
    console.log("ok");
    done();
  });
});

//<#END_FILE: test-stream-unshift-read-race.js
