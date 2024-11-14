//#FILE: test-zlib-params.js
//#SHA1: d7d1b0c78ae9b4b5df5a1057c18fc7f2ef735526
//-----------------
"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const fixturesPath = path.join(__dirname, "..", "fixtures");
const file = fs.readFileSync(path.join(fixturesPath, "person.jpg"));
const chunkSize = 12 * 1024;
const opts = { level: 9, strategy: zlib.constants.Z_DEFAULT_STRATEGY };

test("zlib params change mid-stream", done => {
  const deflater = zlib.createDeflate(opts);

  const chunk1 = file.slice(0, chunkSize);
  const chunk2 = file.slice(chunkSize);
  const blkhdr = Buffer.from([0x00, 0x5a, 0x82, 0xa5, 0x7d]);
  const blkftr = Buffer.from("010000ffff7dac3072", "hex");
  const expected = Buffer.concat([blkhdr, chunk2, blkftr]);
  const bufs = [];

  function read() {
    let buf;
    while ((buf = deflater.read()) !== null) {
      bufs.push(buf);
    }
  }

  deflater.write(chunk1, () => {
    deflater.params(0, zlib.constants.Z_DEFAULT_STRATEGY, () => {
      while (deflater.read());

      deflater.on("readable", read);

      deflater.end(chunk2);
    });
    while (deflater.read());
  });

  deflater.on("end", () => {
    const actual = Buffer.concat(bufs);
    expect(actual).toEqual(expected);
    done();
  });
});

//<#END_FILE: test-zlib-params.js
