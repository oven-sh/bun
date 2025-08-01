import { beforeEach, describe, expect, it } from "bun:test";
import { Readable, Writable, WritableOptions } from "stream";

const ABC = new Uint8Array([0x41, 0x42, 0x43]);
const DEF = new Uint8Array([0x44, 0x45, 0x46]);
const GHI = new Uint8Array([0x47, 0x48, 0x49]);

describe("Writable", () => {
  let called: number[];

  function logCall(fn: WritableOptions["write"], id: number) {
    return function () {
      called[id] = (called[id] || 0) + 1;
      // @ts-ignore
      return fn.apply(this, arguments);
    };
  }

  beforeEach(() => {
    called = [];
  });

  it("should perform simple operations", () => {
    let n = 0;
    const writable = new Writable({
      write: logCall((chunk, encoding, cb) => {
        expect(chunk instanceof Buffer).toBe(true);
        if (n++ === 0) {
          expect(String(chunk)).toBe("ABC");
        } else {
          expect(String(chunk)).toBe("DEF");
        }

        cb();
      }, 0),
    });

    writable.write(ABC);
    writable.end(DEF);
    expect(called).toEqual([2]);
  });

  it("should pass in Uint8Array in object mode", () => {
    const writable = new Writable({
      objectMode: true,
      write: logCall((chunk, encoding, cb) => {
        expect(chunk instanceof Buffer).toBe(false);
        expect(chunk instanceof Uint8Array).toBe(true);
        expect(chunk).toStrictEqual(ABC);
        expect(encoding).toBeUndefined();
        cb();
      }, 0),
    });

    writable.end(ABC);
    expect(called).toEqual([1]);
  });

  it("should handle multiple writes carried out via writev()", () => {
    let callback!: () => void;

    const writable = new Writable({
      write: logCall((chunk, encoding, cb) => {
        expect(chunk instanceof Buffer).toBe(true);
        expect(encoding).toBe("buffer");
        expect(String(chunk)).toBe("ABC");
        callback = cb;
      }, 0),
      writev: logCall((chunks, cb) => {
        expect(chunks.length).toBe(2);
        expect(chunks[0].encoding).toBe("buffer");
        expect(chunks[1].encoding).toBe("buffer");
        expect(chunks[0].chunk + chunks[1].chunk).toBe("DEFGHI");
      }, 1),
    });

    writable.write(ABC);
    writable.write(DEF);
    writable.end(GHI);
    callback();
    expect(called).toEqual([1, 1]);
  });
});

describe("Readable", () => {
  it("should perform simple operations", () => {
    const readable = new Readable({
      read() {},
    });

    readable.push(DEF);
    readable.unshift(ABC);

    const buf = readable.read();
    expect(buf instanceof Buffer).toBe(true);
    expect([...buf]).toEqual([...ABC, ...DEF]);
  });

  it("should work with setEncoding()", () => {
    const readable = new Readable({
      read() {},
    });

    readable.setEncoding("utf8");

    readable.push(DEF);
    readable.unshift(ABC);

    const out = readable.read();
    expect(out).toBe("ABCDEF");
  });
});
