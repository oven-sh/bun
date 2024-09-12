//#FILE: test-console-log-stdio-broken-dest.js
//#SHA1: c2c2e85eeb28db4ace2c4bb0a86f46f7e7bf2682
//-----------------
"use strict";

const { Writable } = require("stream");
const { Console } = require("console");
const { EventEmitter } = require("events");

test("Console log with broken destination", done => {
  const stream = new Writable({
    write(chunk, enc, cb) {
      cb();
    },
    writev(chunks, cb) {
      setTimeout(cb, 10, new Error("kaboom"));
    },
  });
  const myConsole = new Console(stream, stream);

  const warningListener = jest.fn();
  process.on("warning", warningListener);

  stream.cork();
  for (let i = 0; i < EventEmitter.defaultMaxListeners + 1; i++) {
    myConsole.log("a message");
  }
  stream.uncork();

  // We need to wait for the next tick to ensure the error has time to propagate
  process.nextTick(() => {
    expect(warningListener).not.toHaveBeenCalled();
    process.removeListener("warning", warningListener);
    done();
  });
});

//<#END_FILE: test-console-log-stdio-broken-dest.js
