//#FILE: test-readline-csi.js
//#SHA1: 6c80ba1b15c53086d80064d93c6f4cf56d1056d6
//-----------------
"use strict";

const readline = require("readline");
const { Writable } = require("stream");

// Mock the CSI object
const CSI = {
  kClearToLineBeginning: "\x1b[1K",
  kClearToLineEnd: "\x1b[0K",
  kClearLine: "\x1b[2K",
  kClearScreenDown: "\x1b[0J",
};

test("CSI constants", () => {
  expect(CSI).toBeDefined();
  expect(CSI.kClearToLineBeginning).toBe("\x1b[1K");
  expect(CSI.kClearToLineEnd).toBe("\x1b[0K");
  expect(CSI.kClearLine).toBe("\x1b[2K");
  expect(CSI.kClearScreenDown).toBe("\x1b[0J");
});

class TestWritable extends Writable {
  constructor() {
    super();
    this.data = "";
  }
  _write(chunk, encoding, callback) {
    this.data += chunk.toString();
    callback();
  }
}

let writable;

beforeEach(() => {
  writable = new TestWritable();
});

test("clearScreenDown", () => {
  expect(readline.clearScreenDown(writable)).toBe(true);
  expect(writable.data).toBe(CSI.kClearScreenDown);

  writable.data = "";
  expect(readline.clearScreenDown(writable, jest.fn())).toBe(true);

  expect(() => {
    readline.clearScreenDown(writable, null);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  expect(readline.clearScreenDown(null, jest.fn())).toBe(true);
  expect(readline.clearScreenDown(undefined, jest.fn())).toBe(true);
});

test("clearLine", () => {
  expect(readline.clearLine(writable, -1)).toBe(true);
  expect(writable.data).toBe(CSI.kClearToLineBeginning);

  writable.data = "";
  expect(readline.clearLine(writable, 1)).toBe(true);
  expect(writable.data).toBe(CSI.kClearToLineEnd);

  writable.data = "";
  expect(readline.clearLine(writable, 0)).toBe(true);
  expect(writable.data).toBe(CSI.kClearLine);

  writable.data = "";
  expect(readline.clearLine(writable, -1, jest.fn())).toBe(true);
  expect(writable.data).toBe(CSI.kClearToLineBeginning);

  expect(() => {
    readline.clearLine(writable, 0, null);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  expect(readline.clearLine(null, 0)).toBe(true);
  expect(readline.clearLine(undefined, 0)).toBe(true);
  expect(readline.clearLine(null, 0, jest.fn())).toBe(true);
  expect(readline.clearLine(undefined, 0, jest.fn())).toBe(true);
});

test("moveCursor", () => {
  const testCases = [
    [0, 0, ""],
    [1, 0, "\x1b[1C"],
    [-1, 0, "\x1b[1D"],
    [0, 1, "\x1b[1B"],
    [0, -1, "\x1b[1A"],
    [1, 1, "\x1b[1C\x1b[1B"],
    [-1, 1, "\x1b[1D\x1b[1B"],
    [-1, -1, "\x1b[1D\x1b[1A"],
    [1, -1, "\x1b[1C\x1b[1A"],
  ];

  testCases.forEach(([dx, dy, expected]) => {
    writable.data = "";
    expect(readline.moveCursor(writable, dx, dy)).toBe(true);
    expect(writable.data).toBe(expected);

    writable.data = "";
    expect(readline.moveCursor(writable, dx, dy, jest.fn())).toBe(true);
    expect(writable.data).toBe(expected);
  });

  expect(() => {
    readline.moveCursor(writable, 1, 1, null);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  expect(readline.moveCursor(null, 1, 1)).toBe(true);
  expect(readline.moveCursor(undefined, 1, 1)).toBe(true);
  expect(readline.moveCursor(null, 1, 1, jest.fn())).toBe(true);
  expect(readline.moveCursor(undefined, 1, 1, jest.fn())).toBe(true);
});

test("cursorTo", () => {
  expect(readline.cursorTo(null)).toBe(true);
  expect(readline.cursorTo()).toBe(true);
  expect(readline.cursorTo(null, 1, 1, jest.fn())).toBe(true);
  expect(readline.cursorTo(undefined, 1, 1, jest.fn())).toBe(true);

  expect(readline.cursorTo(writable, "a")).toBe(true);
  expect(writable.data).toBe("");

  writable.data = "";
  expect(readline.cursorTo(writable, "a", "b")).toBe(true);
  expect(writable.data).toBe("");

  writable.data = "";
  expect(() => readline.cursorTo(writable, "a", 1)).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_CURSOR_POS",
      message: "Cannot set cursor row without setting its column",
    }),
  );
  expect(writable.data).toBe("");

  writable.data = "";
  expect(readline.cursorTo(writable, 1, "a")).toBe(true);
  expect(writable.data).toBe("\x1b[2G");

  writable.data = "";
  expect(readline.cursorTo(writable, 1)).toBe(true);
  expect(writable.data).toBe("\x1b[2G");

  writable.data = "";
  expect(readline.cursorTo(writable, 1, 2)).toBe(true);
  expect(writable.data).toBe("\x1b[3;2H");

  writable.data = "";
  expect(readline.cursorTo(writable, 1, 2, jest.fn())).toBe(true);
  expect(writable.data).toBe("\x1b[3;2H");

  writable.data = "";
  expect(readline.cursorTo(writable, 1, jest.fn())).toBe(true);
  expect(writable.data).toBe("\x1b[2G");

  expect(() => {
    readline.cursorTo(writable, 1, 1, null);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  expect(() => {
    readline.cursorTo(writable, NaN);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
    }),
  );

  expect(() => {
    readline.cursorTo(writable, 1, NaN);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
    }),
  );

  expect(() => {
    readline.cursorTo(writable, NaN, NaN);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
    }),
  );
});

//<#END_FILE: test-readline-csi.js
