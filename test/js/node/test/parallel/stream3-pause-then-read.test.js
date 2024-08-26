//#FILE: test-stream3-pause-then-read.js
//#SHA1: bd44dc04c63140e4b65c0755eec67a55eaf48158
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
const Readable = stream.Readable;
const Writable = stream.Writable;

const totalChunks = 100;
const chunkSize = 99;
const expectTotalData = totalChunks * chunkSize;
let expectEndingData = expectTotalData;

let r, totalPushed;

beforeEach(() => {
  r = new Readable({ highWaterMark: 1000 });
  let chunks = totalChunks;
  r._read = function (n) {
    console.log("_read called", chunks);
    if (!(chunks % 2)) setImmediate(push);
    else if (!(chunks % 3)) process.nextTick(push);
    else push();
  };

  totalPushed = 0;
  function push() {
    const chunk = chunks-- > 0 ? Buffer.alloc(chunkSize, "x") : null;
    if (chunk) {
      totalPushed += chunk.length;
    }
    console.log("chunks", chunks);
    r.push(chunk);
  }
});

test("stream3 pause then read", async () => {
  await read100();
  await new Promise(resolve => setImmediate(resolve));
  await pipeLittle();
  await read1234();
  await resumePause();
  await pipe();
});

// First we read 100 bytes.
async function read100() {
  await readn(100);
}

async function readn(n) {
  console.error(`read ${n}`);
  expectEndingData -= n;
  return new Promise(resolve => {
    function read() {
      const c = r.read(n);
      console.error("c", c);
      if (!c) r.once("readable", read);
      else {
        expect(c.length).toBe(n);
        expect(r.readableFlowing).toBeFalsy();
        resolve();
      }
    }
    read();
  });
}

// Then we listen to some data events.
function onData() {
  return new Promise(resolve => {
    expectEndingData -= 100;
    console.error("onData");
    let seen = 0;
    r.on("data", function od(c) {
      seen += c.length;
      if (seen >= 100) {
        // Seen enough
        r.removeListener("data", od);
        r.pause();
        if (seen > 100) {
          // Oh no, seen too much!
          // Put the extra back.
          const diff = seen - 100;
          r.unshift(c.slice(c.length - diff));
          console.error("seen too much", seen, diff);
        }
        resolve();
      }
    });
  });
}

// Just pipe 200 bytes, then unshift the extra and unpipe.
async function pipeLittle() {
  expectEndingData -= 200;
  console.error("pipe a little");
  const w = new Writable();
  let written = 0;
  await new Promise(resolve => {
    w.on("finish", () => {
      expect(written).toBe(200);
      resolve();
    });
    w._write = function (chunk, encoding, cb) {
      written += chunk.length;
      if (written >= 200) {
        r.unpipe(w);
        w.end();
        cb();
        if (written > 200) {
          const diff = written - 200;
          written -= diff;
          r.unshift(chunk.slice(chunk.length - diff));
        }
      } else {
        setImmediate(cb);
      }
    };
    r.pipe(w);
  });
}

// Now read 1234 more bytes.
async function read1234() {
  await readn(1234);
}

function resumePause() {
  console.error("resumePause");
  // Don't read anything, just resume and re-pause a whole bunch.
  r.resume();
  r.pause();
  r.resume();
  r.pause();
  r.resume();
  r.pause();
  r.resume();
  r.pause();
  r.resume();
  r.pause();
  return new Promise(resolve => setImmediate(resolve));
}

function pipe() {
  console.error("pipe the rest");
  const w = new Writable();
  let written = 0;
  w._write = function (chunk, encoding, cb) {
    written += chunk.length;
    cb();
  };
  return new Promise(resolve => {
    w.on("finish", () => {
      console.error("written", written, totalPushed);
      expect(written).toBe(expectEndingData);
      expect(totalPushed).toBe(expectTotalData);
      console.log("ok");
      resolve();
    });
    r.pipe(w);
  });
}

//<#END_FILE: test-stream3-pause-then-read.js
