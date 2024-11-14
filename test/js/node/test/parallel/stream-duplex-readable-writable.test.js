//#FILE: test-stream-duplex-readable-writable.js
//#SHA1: d56d29f5fbb8adc3d61708839985f0ea7ffb9b5c
//-----------------
"use strict";

const { Duplex } = require("stream");

test("Duplex with readable false", () => {
  const duplex = new Duplex({
    readable: false,
  });
  expect(duplex.readable).toBe(false);
  duplex.push("asd");

  const errorHandler = jest.fn();
  duplex.on("error", errorHandler);

  const dataHandler = jest.fn();
  duplex.on("data", dataHandler);

  const endHandler = jest.fn();
  duplex.on("end", endHandler);

  return new Promise(resolve => {
    setImmediate(() => {
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ERR_STREAM_PUSH_AFTER_EOF",
          message: expect.any(String),
        }),
      );
      expect(dataHandler).not.toHaveBeenCalled();
      expect(endHandler).not.toHaveBeenCalled();
      resolve();
    });
  });
});

test("Duplex with writable false", () => {
  const writeSpy = jest.fn();
  const duplex = new Duplex({
    writable: false,
    write: writeSpy,
  });
  expect(duplex.writable).toBe(false);
  duplex.write("asd");

  const errorHandler = jest.fn();
  duplex.on("error", errorHandler);

  const finishHandler = jest.fn();
  duplex.on("finish", finishHandler);

  return new Promise(resolve => {
    setImmediate(() => {
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "ERR_STREAM_WRITE_AFTER_END",
          message: expect.any(String),
        }),
      );
      expect(writeSpy).not.toHaveBeenCalled();
      expect(finishHandler).not.toHaveBeenCalled();
      resolve();
    });
  });
});

test("Duplex with readable false and async iteration", async () => {
  const duplex = new Duplex({
    readable: false,
  });
  expect(duplex.readable).toBe(false);

  const dataHandler = jest.fn();
  duplex.on("data", dataHandler);

  const endHandler = jest.fn();
  duplex.on("end", endHandler);

  async function run() {
    for await (const chunk of duplex) {
      expect(chunk).toBeFalsy(); // This should never be reached
    }
  }

  await run();

  expect(dataHandler).not.toHaveBeenCalled();
  expect(endHandler).not.toHaveBeenCalled();
});

//<#END_FILE: test-stream-duplex-readable-writable.js
