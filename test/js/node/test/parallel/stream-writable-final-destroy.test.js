//#FILE: test-stream-writable-final-destroy.js
//#SHA1: 4213d1382f0e5b950211e183a94adc5f3e7a1468
//-----------------
"use strict";

const { Writable } = require("stream");

test("Writable stream with final and destroy", () => {
  const w = new Writable({
    write(chunk, encoding, callback) {
      callback(null);
    },
    final(callback) {
      queueMicrotask(callback);
    },
  });

  w.end();
  w.destroy();

  const prefinishSpy = jest.fn();
  const finishSpy = jest.fn();
  const closeSpy = jest.fn();

  w.on("prefinish", prefinishSpy);
  w.on("finish", finishSpy);
  w.on("close", closeSpy);

  return new Promise(resolve => {
    // Use setImmediate to ensure all microtasks have been processed
    setImmediate(() => {
      expect(prefinishSpy).not.toHaveBeenCalled();
      expect(finishSpy).not.toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalledTimes(1);
      resolve();
    });
  });
});

//<#END_FILE: test-stream-writable-final-destroy.js
