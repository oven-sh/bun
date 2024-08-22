//#FILE: test-readable-single-end.js
//#SHA1: eb85fac7020fa4b5bc4a0f17ba287e8ab3c9dd2f
//-----------------
"use strict";

const { Readable } = require("stream");

// This test ensures that there will not be an additional empty 'readable'
// event when stream has ended (only 1 event signalling about end)

test("Readable stream emits only one event when ended", () => {
  const r = new Readable({
    read: () => {},
  });

  r.push(null);

  const readableSpy = jest.fn();
  const endSpy = jest.fn();

  r.on("readable", readableSpy);
  r.on("end", endSpy);

  return new Promise(resolve => {
    setTimeout(() => {
      expect(readableSpy).toHaveBeenCalledTimes(1);
      expect(endSpy).toHaveBeenCalledTimes(1);
      resolve();
    }, 0);
  });
});

//<#END_FILE: test-readable-single-end.js
