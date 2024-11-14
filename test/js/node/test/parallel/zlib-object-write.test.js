//#FILE: test-zlib-object-write.js
//#SHA1: 8866194c1a944026a655101d66189f364b414ad7
//-----------------
"use strict";

const { Gunzip } = require("zlib");

test("Gunzip in object mode throws on non-buffer write", () => {
  const gunzip = new Gunzip({ objectMode: true });

  // We use jest.fn() to create a mock function that we expect not to be called
  const errorHandler = jest.fn();
  gunzip.on("error", errorHandler);

  expect(() => {
    gunzip.write({});
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  // Verify that the error handler was not called
  expect(errorHandler).not.toHaveBeenCalled();
});

//<#END_FILE: test-zlib-object-write.js
