import { describe, expect, it } from "bun:test";
import { randomBytes, randomFill, randomFillSync, randomInt } from "crypto";

describe("randomInt args validation", () => {
  it("default min is 0 so max should be greater than 0", () => {
    expect(() => randomInt(-1)).toThrow(RangeError);
    expect(() => randomInt(0)).toThrow(RangeError);
  });
  it("max should be >= min", () => {
    expect(() => randomInt(1, 0)).toThrow(RangeError);
    expect(() => randomInt(10, 5)).toThrow(RangeError);
  });

  it("we allow negative numbers", () => {
    expect(() => randomInt(-2, -1)).not.toThrow(RangeError);
  });

  it("max/min should not be greater than Number.MAX_SAFE_INTEGER or less than Number.MIN_SAFE_INTEGER", () => {
    expect(() => randomInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });

  it("max - min should be <= 281474976710655", () => {
    expect(() => randomInt(-2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("accept large negative numbers", () => {
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1)).not.toThrow(RangeError);
  });

  it("should return undefined if called with callback", async () => {
    const { resolve, promise } = Promise.withResolvers();

    expect(
      randomInt(1, 2, (err, num) => {
        expect(err).toBeUndefined();
        expect(num).toBe(1);
        resolve();
      }),
    ).toBeUndefined();

    await promise;
  });
});

describe("randomBytes", () => {
  it("error should be null", async () => {
    const { resolve, promise } = Promise.withResolvers();

    randomBytes(10, (err, buf) => {
      expect(err).toBeNull();
      expect(buf).toBeInstanceOf(Buffer);
      resolve();
    });

    await promise;
  });
});

describe("randomFill bounds checking", () => {
  // f32 can only represent integers exactly up to 2**24 (16777216). Previously the
  // bounds check in assertSize cast the u32 offset to f32 before adding, so an offset
  // of 16777217 rounded down to 16777216 and `size + offset > length` passed when the
  // true sum exceeded the buffer length, leading to a heap write past the end.
  it("randomFillSync rejects size + offset > length when offset exceeds 2**24", () => {
    const length = 2 ** 24 + 2; // 16777218
    const offset = 2 ** 24 + 1; // 16777217 -> rounds to 16777216 as f32
    const size = 2; // offset + size = 16777219 > 16777218
    expect(() => randomFillSync(new ArrayBuffer(length), offset, size)).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
  });

  it("randomFillSync still accepts size + offset == length at the f32 precision boundary", () => {
    const length = 2 ** 24 + 2;
    const offset = 2 ** 24 + 1;
    const size = 1; // offset + size = 16777218 == length, should be fine
    const buf = new Uint8Array(length);
    expect(() => randomFillSync(buf, offset, size)).not.toThrow();
  });

  it("randomFill (async) rejects size + offset > length when offset exceeds 2**24", () => {
    const length = 2 ** 24 + 2;
    const offset = 2 ** 24 + 1;
    const size = 2;
    // Validation errors are thrown synchronously even for the async API.
    expect(() => randomFill(new ArrayBuffer(length), offset, size, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
  });

  it("randomFill (async) still accepts size + offset == length at the f32 precision boundary", async () => {
    const length = 2 ** 24 + 2;
    const offset = 2 ** 24 + 1;
    const size = 1;
    const buf = new Uint8Array(length);
    const { promise, resolve } = Promise.withResolvers<Error | null>();
    randomFill(buf, offset, size, err => resolve(err));
    expect(await promise).toBeNull();
  });
});

describe("randomFill default size with multi-byte typed arrays", () => {
  // In the 3-arg form `randomFill(buf, offset, cb)`, the default size was computed
  // as `buf.len - offset` where `buf.len` is the element count but `offset` had
  // already been scaled to a byte offset by assertOffset. For element_size > 1 this
  // either underflowed (panic in debug) or under-filled the buffer.
  it("randomFill(Float64Array, offset, cb) does not underflow when byte offset > element count", async () => {
    const buf = new Float64Array(10); // 80 bytes, 10 elements
    const { promise, resolve } = Promise.withResolvers<Error | null>();
    // offset 2 elements = 16 bytes; previously computed size as 10 - 16 -> underflow
    randomFill(buf, 2, err => resolve(err));
    expect(await promise).toBeNull();
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);
  });

  it("randomFill passes the buffer (not 0) to the callback when size is 0", async () => {
    const buf = new Uint8Array(0);
    const { promise, resolve } = Promise.withResolvers<[Error | null, unknown]>();
    randomFill(buf, (err, b) => resolve([err, b]));
    const [err, b] = await promise;
    expect(err).toBeNull();
    expect(b).toBe(buf);
  });

  it("randomFill(Float64Array, offset, cb) fills to the end of the buffer", async () => {
    // Run several times since each byte has a 1/256 chance of being 0 anyway.
    let tailFilled = false;
    for (let i = 0; i < 8 && !tailFilled; i++) {
      const buf = new Float64Array(100); // 800 bytes
      const { promise, resolve } = Promise.withResolvers<Error | null>();
      randomFill(buf, 1, err => resolve(err));
      expect(await promise).toBeNull();
      // Previously only bytes 8..744 were filled; bytes 744..800 stayed zero.
      const bytes = new Uint8Array(buf.buffer);
      if (bytes.subarray(744, 800).some(b => b !== 0)) tailFilled = true;
    }
    expect(tailFilled).toBe(true);
  });
});
