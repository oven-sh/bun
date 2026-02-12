import { describe, expect, test } from "bun:test";

describe("Buffer.indexOf/lastIndexOf/includes with detached buffer via valueOf", () => {
  test("indexOf throws TypeError when buffer is detached via valueOf on byteOffset", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    expect(() => {
      buf.indexOf(0x42, {
        valueOf() {
          ab.transfer(2048);
          return 0;
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("lastIndexOf throws TypeError when buffer is detached via valueOf on byteOffset", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    expect(() => {
      buf.lastIndexOf(0x42, {
        valueOf() {
          ab.transfer(2048);
          return 0;
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("includes throws TypeError when buffer is detached via valueOf on byteOffset", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    expect(() => {
      buf.includes(0x42, {
        valueOf() {
          ab.transfer(2048);
          return 0;
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("indexOf with string value throws TypeError when buffer is detached via valueOf on byteOffset", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x41); // 'A'

    expect(() => {
      buf.indexOf("A", {
        valueOf() {
          ab.transfer(2048);
          return 0;
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("indexOf with Buffer value throws TypeError when buffer is detached via valueOf on byteOffset", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);
    const needle = Buffer.from([0x42]);

    expect(() => {
      buf.indexOf(needle, {
        valueOf() {
          ab.transfer(2048);
          return 0;
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("indexOf with string value throws TypeError when buffer is detached via encoding toString", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x41); // 'A'

    expect(() => {
      buf.indexOf("A", 0, {
        toString() {
          ab.transfer(2048);
          return "utf8";
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("indexOf with Buffer value throws TypeError when buffer is detached via encoding toString", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);
    const needle = Buffer.from([0x42]);

    expect(() => {
      buf.indexOf(needle, 0, {
        toString() {
          ab.transfer(2048);
          return "utf8";
        },
      } as any);
    }).toThrow(TypeError);
  });

  test("indexOf still works correctly when buffer is not detached", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    expect(buf.indexOf(3)).toBe(2);
    expect(buf.indexOf(3, 3)).toBe(-1);
    expect(buf.lastIndexOf(3)).toBe(2);
    expect(buf.includes(3)).toBe(true);
    expect(buf.includes(6)).toBe(false);
  });

  test("indexOf with valueOf that does not detach still works correctly", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const result = buf.indexOf(3, {
      valueOf() {
        return 0;
      },
    } as any);
    expect(result).toBe(2);
  });
});
