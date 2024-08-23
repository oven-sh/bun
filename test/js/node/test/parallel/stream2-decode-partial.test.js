//#FILE: test-stream2-decode-partial.js
//#SHA1: bc4bec1c0be7857c86b9cd75dbb76b939d9619ab
//-----------------
"use strict";

const { Readable } = require("stream");

let buf = "";
const euro = Buffer.from([0xe2, 0x82, 0xac]);
const cent = Buffer.from([0xc2, 0xa2]);
const source = Buffer.concat([euro, cent]);

test("Readable stream decodes partial UTF-8 characters correctly", done => {
  const readable = Readable({ encoding: "utf8" });
  readable.push(source.slice(0, 2));
  readable.push(source.slice(2, 4));
  readable.push(source.slice(4, 6));
  readable.push(null);

  readable.on("data", function (data) {
    buf += data;
  });

  readable.on("end", function () {
    expect(buf).toBe("€¢");
    done();
  });
});

//<#END_FILE: test-stream2-decode-partial.js
