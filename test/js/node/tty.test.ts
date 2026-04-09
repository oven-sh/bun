import { describe, expect, it } from "bun:test";
import { isWindows } from "harness";
import fs from "node:fs";
import { ReadStream, WriteStream } from "node:tty";

describe("WriteStream.prototype.getColorDepth", () => {
  it("iTerm ancient", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
      }),
    ).toBe(isWindows ? 24 : 8);
  });

  it("iTerm modern", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
        TERM_PROGRAM_VERSION: 3,
      }),
    ).toBe(24);
  });

  it("empty", () => {
    expect(WriteStream.prototype.getColorDepth.call(undefined, {})).toBe(isWindows ? 24 : 1);
  });
});

describe("tty.{ReadStream,WriteStream}.prototype.isTTY", () => {
  it("WriteStream.prototype.isTTY is true", () => {
    // Matches Node.js: `tty.WriteStream.prototype.isTTY === true`.
    expect(WriteStream.prototype.isTTY).toBe(true);
  });

  it("ReadStream.prototype.isTTY is true", () => {
    // Matches Node.js: `tty.ReadStream.prototype.isTTY === true`.
    expect(ReadStream.prototype.isTTY).toBe(true);
  });

  it("does not pollute fs.WriteStream.prototype", () => {
    // tty.WriteStream inherits from fs.WriteStream but must not add tty-only
    // members to fs.WriteStream.prototype. `isTTY` and the cursor helpers
    // should only exist on the tty subclass prototype.
    expect(Object.hasOwn(fs.WriteStream.prototype, "isTTY")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "clearLine")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "clearScreenDown")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "cursorTo")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "getColorDepth")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "hasColors")).toBe(false);
    expect(Object.hasOwn(fs.WriteStream.prototype, "moveCursor")).toBe(false);

    // fs.WriteStream instances must not inherit isTTY from anywhere either.
    expect((fs.WriteStream.prototype as any).isTTY).toBeUndefined();
  });

  it("tty.WriteStream.prototype is distinct from fs.WriteStream.prototype", () => {
    expect(WriteStream.prototype).not.toBe(fs.WriteStream.prototype);
    // ...but still inherits from it, so `instanceof fs.WriteStream` holds for
    // tty.WriteStream instances.
    expect(Object.getPrototypeOf(WriteStream.prototype)).toBe(fs.WriteStream.prototype);
  });
});
