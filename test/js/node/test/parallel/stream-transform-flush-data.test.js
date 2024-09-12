//#FILE: test-stream-transform-flush-data.js
//#SHA1: 04d0db2bec19ea79b0914db96fd2c996ab8d67bd
//-----------------
"use strict";

const { Transform } = require("stream");

test("Transform flush should emit expected data", done => {
  const expected = "asdf";

  function _transform(d, e, n) {
    n();
  }

  function _flush(n) {
    n(null, expected);
  }

  const t = new Transform({
    transform: _transform,
    flush: _flush,
  });

  t.end(Buffer.from("blerg"));
  t.on("data", data => {
    expect(data.toString()).toBe(expected);
    done();
  });
});

//<#END_FILE: test-stream-transform-flush-data.js
