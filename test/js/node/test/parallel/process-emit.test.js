//#FILE: test-process-emit.js
//#SHA1: a019bda4bcc14ef2e20bad3cc89cf8676ed5bc49
//-----------------
"use strict";

const sym = Symbol();

test("process.emit for normal event", () => {
  const listener = jest.fn();
  process.on("normal", listener);

  process.emit("normal", "normalData");

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith("normalData");

  process.removeListener("normal", listener);
});

test("process.emit for symbol event", () => {
  const listener = jest.fn();
  process.on(sym, listener);

  process.emit(sym, "symbolData");

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith("symbolData");

  process.removeListener(sym, listener);
});

test("process.emit for SIGPIPE signal", () => {
  const listener = jest.fn();
  process.on("SIGPIPE", listener);

  process.emit("SIGPIPE", "signalData");

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith("signalData");

  process.removeListener("SIGPIPE", listener);
});

test("process._eventsCount is not NaN", () => {
  expect(Number.isNaN(process._eventsCount)).toBe(false);
});

//<#END_FILE: test-process-emit.js
