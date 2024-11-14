//#FILE: test-stream-transform-callback-twice.js
//#SHA1: f2ad2048f83461d93a84b8b5696230beb4dba9f2
//-----------------
"use strict";

const { Transform } = require("stream");

test("Transform stream callback called twice", done => {
  const stream = new Transform({
    transform(chunk, enc, cb) {
      cb();
      cb();
    },
  });

  stream.on("error", error => {
    expect(error).toMatchObject({
      name: "Error",
      code: "ERR_MULTIPLE_CALLBACK",
      message: expect.any(String),
    });
    done();
  });

  stream.write("foo");
});

//<#END_FILE: test-stream-transform-callback-twice.js
