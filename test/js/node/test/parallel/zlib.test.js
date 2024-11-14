//#FILE: test-zlib.js
//#SHA1: 0e67da3898d627175ffca51fdbd1042571d0c405
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
const zlib = require("zlib");
const stream = require("stream");
const fs = require("fs");
const path = require("path");

const fixturesPath = path.join(__dirname, "..", "fixtures");

// Should not segfault.
test("gzipSync with invalid windowBits", () => {
  expect(() => zlib.gzipSync(Buffer.alloc(0), { windowBits: 8 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
    }),
  );
});

let zlibPairs = [
  [zlib.Deflate, zlib.Inflate],
  [zlib.Gzip, zlib.Gunzip],
  [zlib.Deflate, zlib.Unzip],
  [zlib.Gzip, zlib.Unzip],
  [zlib.DeflateRaw, zlib.InflateRaw],
  [zlib.BrotliCompress, zlib.BrotliDecompress],
];

// How fast to trickle through the slowstream
let trickle = [128, 1024, 1024 * 1024];

// Tunable options for zlib classes.

// several different chunk sizes
let chunkSize = [128, 1024, 1024 * 16, 1024 * 1024];

// This is every possible value.
let level = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
let windowBits = [8, 9, 10, 11, 12, 13, 14, 15];
let memLevel = [1, 2, 3, 4, 5, 6, 7, 8, 9];
let strategy = [0, 1, 2, 3, 4];

// It's nice in theory to test every combination, but it
// takes WAY too long.  Maybe a pummel test could do this?
if (!process.env.PUMMEL) {
  trickle = [1024];
  chunkSize = [1024 * 16];
  level = [6];
  memLevel = [8];
  windowBits = [15];
  strategy = [0];
}

let testFiles = ["person.jpg", "elipses.txt", "empty.txt"];

if (process.env.FAST) {
  zlibPairs = [[zlib.Gzip, zlib.Unzip]];
  testFiles = ["person.jpg"];
}

const tests = {};
testFiles.forEach(file => {
  tests[file] = fs.readFileSync(path.join(fixturesPath, file));
});

// Stream that saves everything
class BufferStream extends stream.Stream {
  constructor() {
    super();
    this.chunks = [];
    this.length = 0;
    this.writable = true;
    this.readable = true;
  }

  write(c) {
    this.chunks.push(c);
    this.length += c.length;
    return true;
  }

  end(c) {
    if (c) this.write(c);
    // flatten
    const buf = Buffer.allocUnsafe(this.length);
    let i = 0;
    this.chunks.forEach(c => {
      c.copy(buf, i);
      i += c.length;
    });
    this.emit("data", buf);
    this.emit("end");
    return true;
  }
}

class SlowStream extends stream.Stream {
  constructor(trickle) {
    super();
    this.trickle = trickle;
    this.offset = 0;
    this.readable = this.writable = true;
  }

  write() {
    throw new Error("not implemented, just call ss.end(chunk)");
  }

  pause() {
    this.paused = true;
    this.emit("pause");
  }

  resume() {
    const emit = () => {
      if (this.paused) return;
      if (this.offset >= this.length) {
        this.ended = true;
        return this.emit("end");
      }
      const end = Math.min(this.offset + this.trickle, this.length);
      const c = this.chunk.slice(this.offset, end);
      this.offset += c.length;
      this.emit("data", c);
      process.nextTick(emit);
    };

    if (this.ended) return;
    this.emit("resume");
    if (!this.chunk) return;
    this.paused = false;
    emit();
  }

  end(chunk) {
    // Walk over the chunk in blocks.
    this.chunk = chunk;
    this.length = chunk.length;
    this.resume();
    return this.ended;
  }
}

test("createDeflateRaw with windowBits 8", () => {
  expect(() => zlib.createDeflateRaw({ windowBits: 8 })).not.toThrow();
});

test("inflate raw with windowBits 8", async () => {
  const node = fs.createReadStream(path.join(fixturesPath, "person.jpg"));
  const raw = [];
  const reinflated = [];

  await new Promise((resolve, reject) => {
    node.on("data", chunk => raw.push(chunk));

    node
      .pipe(zlib.createDeflateRaw({ windowBits: 9 }))
      .pipe(zlib.createInflateRaw({ windowBits: 8 }))
      .on("data", chunk => reinflated.push(chunk))
      .on("end", () => {
        expect(Buffer.concat(raw)).toEqual(Buffer.concat(reinflated));
        resolve();
      })
      .on("error", reject);
  });
});

// For each of the files, make sure that compressing and
// decompressing results in the same data, for every combination
// of the options set above.

const testKeys = Object.keys(tests);
testKeys.forEach(file => {
  const test = tests[file];
  chunkSize.forEach(chunkSize => {
    trickle.forEach(trickle => {
      windowBits.forEach(windowBits => {
        level.forEach(level => {
          memLevel.forEach(memLevel => {
            strategy.forEach(strategy => {
              zlibPairs.forEach(pair => {
                const [Def, Inf] = pair;
                const opts = { level, windowBits, memLevel, strategy };

                it(`${file} ${chunkSize} ${JSON.stringify(opts)} ${Def.name} -> ${Inf.name}`, done => {
                  const def = new Def(opts);
                  const inf = new Inf(opts);
                  const ss = new SlowStream(trickle);
                  const buf = new BufferStream();

                  // Verify that the same exact buffer comes out the other end.
                  buf.on("data", c => {
                    expect(c).toEqual(test);
                    done();
                  });

                  // The magic happens here.
                  ss.pipe(def).pipe(inf).pipe(buf);
                  ss.end(test);
                });
              });
            });
          });
        });
      });
    });
  });
});

//<#END_FILE: test-zlib.js
