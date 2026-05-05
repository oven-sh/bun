// https://github.com/oven-sh/bun/issues/29019
//
// `tty.WriteStream.prototype.isTTY` must be a plain data property with value
// `true`, matching Node.js. Previously Bun omitted it, so
// `tty.WriteStream.prototype.isTTY` was `undefined`.

import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tty from "node:tty";

test("tty.WriteStream.prototype.isTTY is true", () => {
  expect(tty.WriteStream.prototype.isTTY).toBe(true);
});

test("tty.WriteStream.prototype has isTTY as an own property", () => {
  expect(Object.prototype.hasOwnProperty.call(tty.WriteStream.prototype, "isTTY")).toBe(true);
});

test("tty.WriteStream.prototype.isTTY descriptor matches Node", () => {
  const descriptor = Object.getOwnPropertyDescriptor(tty.WriteStream.prototype, "isTTY");
  expect(descriptor).toEqual({
    value: true,
    writable: true,
    enumerable: true,
    configurable: true,
  });
});

test("tty.ReadStream.prototype does not define isTTY (Node parity)", () => {
  // Node only puts isTTY on WriteStream.prototype, not ReadStream.prototype.
  expect(Object.prototype.hasOwnProperty.call(tty.ReadStream.prototype, "isTTY")).toBe(false);
});

test("tty.WriteStream.prototype is distinct from fs.WriteStream.prototype", () => {
  // They must be distinct so that tty-only members (isTTY, hasColors,
  // getColorDepth, cursorTo, ...) don't leak onto every fs.createWriteStream
  // instance.
  expect(tty.WriteStream.prototype).not.toBe(fs.WriteStream.prototype);
});

test("tty-only methods are NOT on fs.WriteStream.prototype", () => {
  // The leak would be caused by the lazy `tty.WriteStream.prototype` getter
  // writing methods onto fs.WriteStream.prototype. Force the getter to run
  // before asserting — otherwise a filtered or reordered test run could pass
  // on buggy code because the getter never fired.
  expect(tty.WriteStream.prototype.isTTY).toBe(true);

  // Regression: previously tty.ts installed hasColors/getColorDepth/... onto
  // fs.WriteStream.prototype itself, which was wrong. Symbol.asyncIterator is
  // included to cover the symbol-keyed leak path too.
  for (const name of [
    "hasColors",
    "getColorDepth",
    "getWindowSize",
    "clearLine",
    "clearScreenDown",
    "cursorTo",
    "moveCursor",
    "_refreshSize",
    Symbol.asyncIterator,
  ] as (string | symbol)[]) {
    expect(Object.prototype.hasOwnProperty.call(fs.WriteStream.prototype, name)).toBe(false);
  }
});

test("tty.WriteStream.prototype owns Symbol.asyncIterator", () => {
  // Sanity check: the symbol IS installed on tty.WriteStream.prototype, so the
  // leak-check loop above is actually testing something (not a tautology).
  expect(Object.prototype.hasOwnProperty.call(tty.WriteStream.prototype, Symbol.asyncIterator)).toBe(true);
});

test("tty.WriteStream.prototype.constructor === tty.WriteStream", () => {
  // Creating the prototype via Object.create(fs.WriteStream.prototype) would
  // otherwise leave `constructor` inherited from fs.WriteStream.prototype,
  // making `new tty.WriteStream(1).constructor === fs.WriteStream`. Node keeps
  // it pointing at tty.WriteStream.
  expect(tty.WriteStream.prototype.constructor).toBe(tty.WriteStream);
  const descriptor = Object.getOwnPropertyDescriptor(tty.WriteStream.prototype, "constructor");
  expect(descriptor).toEqual({
    value: tty.WriteStream,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test("tty.ReadStream.prototype.constructor === tty.ReadStream", () => {
  // Same story as WriteStream: Object.create(fs.ReadStream.prototype) inherits
  // `constructor` from fs.ReadStream.prototype unless we explicitly reset it.
  expect(tty.ReadStream.prototype).not.toBe(fs.ReadStream.prototype);
  expect(tty.ReadStream.prototype.constructor).toBe(tty.ReadStream);
  // And the fix must NOT have touched fs.ReadStream.prototype itself — if a
  // future refactor re-aliased the two prototypes, this would catch it.
  expect(fs.ReadStream.prototype.constructor).toBe(fs.ReadStream);
  const descriptor = Object.getOwnPropertyDescriptor(tty.ReadStream.prototype, "constructor");
  expect(descriptor).toEqual({
    value: tty.ReadStream,
    writable: true,
    enumerable: false,
    configurable: true,
  });
});

test("tty.WriteStream.prototype.isTTY does NOT leak to fs.WriteStream.prototype", () => {
  // Materialize the lazy tty.WriteStream.prototype first so a filtered run
  // of this one test still exercises the getter.
  expect(tty.WriteStream.prototype.isTTY).toBe(true);

  // Regression: if the fix mutated the shared fs.WriteStream.prototype,
  // fs.createWriteStream() instances would start claiming to be TTYs.
  expect(Object.prototype.hasOwnProperty.call(fs.WriteStream.prototype, "isTTY")).toBe(false);
  expect(fs.WriteStream.prototype.isTTY).toBeUndefined();
});

test("fs.createWriteStream() instances do not inherit isTTY === true", () => {
  // Force the lazy tty.WriteStream.prototype getter so a filtered run still
  // exercises it — otherwise the leak could never materialize on buggy code.
  expect(tty.WriteStream.prototype.isTTY).toBe(true);

  const tmp = join(tmpdir(), `bun-29019-${randomUUID()}`);
  const ws = fs.createWriteStream(tmp);
  try {
    // Must not be `true` (would be a tty leak).
    expect(ws.isTTY).toBeUndefined();
  } finally {
    ws.destroy();
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
});

test("tty.WriteStream instance isTTY reflects the fd (not always true)", () => {
  // Constructing with a non-tty fd should produce isTTY === false on the
  // instance, even though the prototype says true. The instance own property
  // shadows the prototype.
  const fd = fs.openSync(process.execPath, "r");
  try {
    const ws = new tty.WriteStream(fd);
    try {
      expect(ws.isTTY).toBe(false);
    } finally {
      try {
        ws.destroy();
      } catch {}
    }
  } finally {
    // tty.WriteStream is constructed with autoClose: false, so ws.destroy()
    // does NOT close the underlying fd — we own it and must close it.
    try {
      fs.closeSync(fd);
    } catch {}
  }
});
