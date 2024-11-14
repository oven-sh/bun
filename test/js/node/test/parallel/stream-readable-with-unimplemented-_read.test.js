//#FILE: test-stream-readable-with-unimplemented-_read.js
//#SHA1: ba318da76b4c594580f62650bad861933a59c215
//-----------------
"use strict";
const { Readable } = require("stream");

test("Readable stream with unimplemented _read method", done => {
  const readable = new Readable();

  readable.read();
  readable.on("error", error => {
    expect(error).toEqual(
      expect.objectContaining({
        code: "ERR_METHOD_NOT_IMPLEMENTED",
        name: "Error",
        message: expect.any(String),
      }),
    );
  });

  readable.on("close", () => {
    done();
  });
});

//<#END_FILE: test-stream-readable-with-unimplemented-_read.js
