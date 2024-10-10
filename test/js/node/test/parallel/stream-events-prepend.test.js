//#FILE: test-stream-events-prepend.js
//#SHA1: db830318b8c5a2e990a75320319c8fcd96fa760a
//-----------------
"use strict";
const stream = require("stream");

class Writable extends stream.Writable {
  constructor() {
    super();
    this.prependListener = undefined;
  }

  _write(chunk, end, cb) {
    cb();
  }
}

class Readable extends stream.Readable {
  _read() {
    this.push(null);
  }
}

test("pipe event is emitted even when prependListener is undefined", () => {
  const w = new Writable();
  const pipeSpy = jest.fn();
  w.on("pipe", pipeSpy);

  const r = new Readable();
  r.pipe(w);

  expect(pipeSpy).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-stream-events-prepend.js
