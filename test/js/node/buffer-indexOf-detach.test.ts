import assert from "node:assert";
import { describe, test } from "node:test";

// When the haystack or needle is detached via a valueOf/toString callback,
// Bun must not read freed memory. We match Node.js behavior: detached buffers
// are treated as having zero length (haystack → -1, needle → empty match at
// the computed byteOffset). No errors are thrown.
//
// This file uses node:test + node:assert so it can run under Node.js as well,
// to verify the expected values match Node.js exactly.
describe("Buffer.indexOf/lastIndexOf/includes with buffer detached via side-effect", () => {
  // --- Haystack detached ---

  test("indexOf returns -1 when haystack is detached via valueOf on byteOffset (number search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    let called = 0;
    const result = buf.indexOf(0x42, {
      valueOf() {
        called++;
        if (called === 1) ab.transfer(2048);
        return 0;
      },
    } as any);
    assert.strictEqual(result, -1);
    assert.strictEqual(buf.buffer.byteLength, 0);
  });

  test("lastIndexOf returns -1 when haystack is detached via valueOf on byteOffset (number search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    let called = 0;
    const result = buf.lastIndexOf(0x42, {
      valueOf() {
        called++;
        if (called === 1) ab.transfer(2048);
        return 0;
      },
    } as any);
    assert.strictEqual(result, -1);
  });

  test("includes returns false when haystack is detached via valueOf on byteOffset (number search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);

    let called = 0;
    const result = buf.includes(0x42, {
      valueOf() {
        called++;
        if (called === 1) ab.transfer(2048);
        return 0;
      },
    } as any);
    assert.strictEqual(result, false);
  });

  test("indexOf returns -1 when haystack is detached via valueOf on byteOffset (string search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x41); // 'A'

    let called = 0;
    const result = buf.indexOf("A", {
      valueOf() {
        called++;
        if (called === 1) ab.transfer(2048);
        return 0;
      },
    } as any);
    assert.strictEqual(result, -1);
  });

  test("indexOf returns -1 when haystack is detached via valueOf on byteOffset (Buffer search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);
    const needle = Buffer.from([0x42]);

    let called = 0;
    const result = buf.indexOf(needle, {
      valueOf() {
        called++;
        if (called === 1) ab.transfer(2048);
        return 0;
      },
    } as any);
    assert.strictEqual(result, -1);
  });

  test("indexOf returns -1 when haystack is detached via encoding toString (string search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x41); // 'A'

    const result = buf.indexOf("A", 0, {
      toString() {
        ab.transfer(2048);
        return "utf8";
      },
    } as any);
    assert.strictEqual(result, -1);
  });

  test("indexOf returns -1 when haystack is detached via encoding toString (Buffer search)", () => {
    const ab = new ArrayBuffer(64);
    const buf = Buffer.from(ab);
    buf.fill(0x42);
    const needle = Buffer.from([0x42]);

    const result = buf.indexOf(needle, 0, {
      toString() {
        ab.transfer(2048);
        return "utf8";
      },
    } as any);
    assert.strictEqual(result, -1);
  });

  // --- Needle detached ---

  test("indexOf treats detached needle as empty when detached via valueOf on byteOffset", () => {
    const buf = Buffer.from("abcdef");
    const needleAb = new ArrayBuffer(3);
    const needle = Buffer.from(needleAb);
    needle[0] = 0x62; // 'b'
    needle[1] = 0x63; // 'c'
    needle[2] = 0x64; // 'd'

    let called = 0;
    const result = buf.indexOf(needle, {
      valueOf() {
        called++;
        if (called === 1) needleAb.transfer(2048);
        return 0;
      },
    } as any);
    // Empty needle at offset 0 → 0
    assert.strictEqual(result, 0);
    assert.strictEqual(needle.buffer.byteLength, 0);
  });

  test("indexOf treats detached needle as empty when detached via encoding toString", () => {
    const buf = Buffer.from("abcdef");
    const needleAb = new ArrayBuffer(3);
    const needle = Buffer.from(needleAb);
    needle[0] = 0x62;
    needle[1] = 0x63;
    needle[2] = 0x64;

    const result = buf.indexOf(needle, 0, {
      toString() {
        needleAb.transfer(2048);
        return "utf8";
      },
    } as any);
    assert.strictEqual(result, 0);
  });

  test("lastIndexOf treats detached needle as empty when detached via valueOf on byteOffset", () => {
    const buf = Buffer.from("abcdef");
    const needleAb = new ArrayBuffer(2);
    const needle = Buffer.from(needleAb);
    needle[0] = 0x63; // 'c'
    needle[1] = 0x64; // 'd'

    let called = 0;
    const result = buf.lastIndexOf(needle, {
      valueOf() {
        called++;
        if (called === 1) needleAb.transfer(2048);
        return 5;
      },
    } as any);
    // Empty needle, lastIndexOf from offset 5 → 5
    assert.strictEqual(result, 5);
  });

  test("indexOf treats detached needle as empty with nonzero byteOffset", () => {
    const buf = Buffer.from("abcdef");
    const needleAb = new ArrayBuffer(3);
    const needle = Buffer.from(needleAb);
    needle.fill(0x62);

    let called = 0;
    const result = buf.indexOf(needle, {
      valueOf() {
        called++;
        if (called === 1) needleAb.transfer(2048);
        return 3;
      },
    } as any);
    // Empty needle at offset 3 → 3
    assert.strictEqual(result, 3);
  });

  // --- Sanity ---

  test("indexOf still works correctly when buffer is not detached", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    assert.strictEqual(buf.indexOf(3), 2);
    assert.strictEqual(buf.indexOf(3, 3), -1);
    assert.strictEqual(buf.lastIndexOf(3), 2);
    assert.strictEqual(buf.includes(3), true);
    assert.strictEqual(buf.includes(6), false);
  });

  test("indexOf with valueOf that does not detach still works correctly", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const result = buf.indexOf(3, {
      valueOf() {
        return 0;
      },
    } as any);
    assert.strictEqual(result, 2);
  });
});
