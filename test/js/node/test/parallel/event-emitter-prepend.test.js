//#FILE: test-event-emitter-prepend.js
//#SHA1: 9a753f44fc304ff6584a31c20e95037e622579d7
//-----------------
"use strict";

const EventEmitter = require("events");
const stream = require("stream");

describe("EventEmitter prepend", () => {
  test("prepend listeners in correct order", () => {
    const myEE = new EventEmitter();
    let m = 0;

    // This one comes last.
    myEE.on("foo", () => {
      expect(m).toBe(2);
    });

    // This one comes second.
    myEE.prependListener("foo", () => {
      expect(m).toBe(1);
      m++;
    });

    // This one comes first.
    myEE.prependOnceListener("foo", () => {
      expect(m).toBe(0);
      m++;
    });

    myEE.emit("foo");
    expect.assertions(3);
  });

  test("fallback if prependListener is undefined", () => {
    // Test fallback if prependListener is undefined.
    delete EventEmitter.prototype.prependListener;

    function Writable() {
      this.writable = true;
      stream.Stream.call(this);
    }
    Object.setPrototypeOf(Writable.prototype, stream.Stream.prototype);
    Object.setPrototypeOf(Writable, stream.Stream);

    function Readable() {
      this.readable = true;
      stream.Stream.call(this);
    }
    Object.setPrototypeOf(Readable.prototype, stream.Stream.prototype);
    Object.setPrototypeOf(Readable, stream.Stream);

    const w = new Writable();
    const r = new Readable();
    r.pipe(w);

    // If we reach this point without throwing, the test passes
    expect(true).toBe(true);
  });
});

//<#END_FILE: test-event-emitter-prepend.js
