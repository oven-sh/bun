//#FILE: test-stream-readable-emittedReadable.js
//#SHA1: 1c9463d9bb0e7927d8d18949aae849a04cc034fe
//-----------------
"use strict";
const { Readable } = require("stream");

describe("Readable Stream emittedReadable", () => {
  test("emittedReadable state changes correctly", () => {
    const readable = new Readable({
      read: () => {},
    });

    // Initialized to false.
    expect(readable._readableState.emittedReadable).toBe(false);

    const expected = [Buffer.from("foobar"), Buffer.from("quo"), null];
    const readableSpy = jest.fn(() => {
      // emittedReadable should be true when the readable event is emitted
      expect(readable._readableState.emittedReadable).toBe(true);
      expect(readable.read()).toEqual(expected.shift());
      // emittedReadable is reset to false during read()
      expect(readable._readableState.emittedReadable).toBe(false);
    });

    readable.on("readable", readableSpy);

    // When the first readable listener is just attached,
    // emittedReadable should be false
    expect(readable._readableState.emittedReadable).toBe(false);

    // These trigger a single 'readable', as things are batched up
    process.nextTick(() => {
      readable.push("foo");
    });
    process.nextTick(() => {
      readable.push("bar");
    });

    // These triggers two readable events
    setImmediate(() => {
      readable.push("quo");
      process.nextTick(() => {
        readable.push(null);
      });
    });

    return new Promise(resolve => {
      setTimeout(() => {
        expect(readableSpy).toHaveBeenCalledTimes(3);
        resolve();
      }, 100);
    });
  });

  test("emittedReadable with read(0)", () => {
    const noRead = new Readable({
      read: () => {},
    });

    const readableSpy = jest.fn(() => {
      // emittedReadable should be true when the readable event is emitted
      expect(noRead._readableState.emittedReadable).toBe(true);
      noRead.read(0);
      // emittedReadable is not reset during read(0)
      expect(noRead._readableState.emittedReadable).toBe(true);
    });

    noRead.on("readable", readableSpy);

    noRead.push("foo");
    noRead.push(null);

    return new Promise(resolve => {
      setTimeout(() => {
        expect(readableSpy).toHaveBeenCalledTimes(1);
        resolve();
      }, 100);
    });
  });

  test("emittedReadable in flowing mode", () => {
    const flowing = new Readable({
      read: () => {},
    });

    const dataSpy = jest.fn(() => {
      // When in flowing mode, emittedReadable is always false.
      expect(flowing._readableState.emittedReadable).toBe(false);
      flowing.read();
      expect(flowing._readableState.emittedReadable).toBe(false);
    });

    flowing.on("data", dataSpy);

    flowing.push("foooo");
    flowing.push("bar");
    flowing.push("quo");
    process.nextTick(() => {
      flowing.push(null);
    });

    return new Promise(resolve => {
      setTimeout(() => {
        expect(dataSpy).toHaveBeenCalledTimes(3);
        resolve();
      }, 100);
    });
  });
});

//<#END_FILE: test-stream-readable-emittedReadable.js
