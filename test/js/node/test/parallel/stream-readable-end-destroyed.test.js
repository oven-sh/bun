//#FILE: test-stream-readable-end-destroyed.js
//#SHA1: 20c8bb870db11018d2eaa1c9e4dece071917d03d
//-----------------
"use strict";

const { Readable } = require("stream");

test("Don't emit 'end' after 'close'", () => {
  const r = new Readable();

  const endListener = jest.fn();
  r.on("end", endListener);
  r.resume();
  r.destroy();

  return new Promise(resolve => {
    r.on("close", () => {
      r.push(null);
      expect(endListener).not.toHaveBeenCalled();
      resolve();
    });
  });
});

//<#END_FILE: test-stream-readable-end-destroyed.js
