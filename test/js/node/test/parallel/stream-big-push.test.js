//#FILE: test-stream-big-push.js
//#SHA1: 833718bae7463fa469ed5acc9a1c69aa321785b7
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
const str = "asdfasdfasdfasdfasdf";

test("stream big push", async () => {
  const r = new stream.Readable({
    highWaterMark: 5,
    encoding: "utf8",
  });

  let reads = 0;

  function _read() {
    if (reads === 0) {
      setTimeout(() => {
        r.push(str);
      }, 1);
      reads++;
    } else if (reads === 1) {
      const ret = r.push(str);
      expect(ret).toBe(false);
      reads++;
    } else {
      r.push(null);
    }
  }

  r._read = jest.fn(_read);

  const endPromise = new Promise(resolve => {
    r.on("end", resolve);
  });

  // Push some data in to start.
  // We've never gotten any read event at this point.
  const ret = r.push(str);
  // Should be false.  > hwm
  expect(ret).toBe(false);
  let chunk = r.read();
  expect(chunk).toBe(str);
  chunk = r.read();
  expect(chunk).toBeNull();

  await new Promise(resolve => {
    r.once("readable", () => {
      // This time, we'll get *all* the remaining data, because
      // it's been added synchronously, as the read WOULD take
      // us below the hwm, and so it triggered a _read() again,
      // which synchronously added more, which we then return.
      chunk = r.read();
      expect(chunk).toBe(str + str);

      chunk = r.read();
      expect(chunk).toBeNull();
      resolve();
    });
  });

  await endPromise;
  expect(r._read).toHaveBeenCalledTimes(3);
});

//<#END_FILE: test-stream-big-push.js
