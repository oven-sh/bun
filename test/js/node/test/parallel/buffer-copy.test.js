//#FILE: test-buffer-copy.js
//#SHA1: bff8bfe75b7289a279d9fc1a1bf2293257282d27
//-----------------
"use strict";

test("Buffer copy operations", () => {
  const b = Buffer.allocUnsafe(1024);
  const c = Buffer.allocUnsafe(512);

  let cntr = 0;

  // Copy 512 bytes, from 0 to 512.
  b.fill(++cntr);
  c.fill(++cntr);
  const copied = b.copy(c, 0, 0, 512);
  expect(copied).toBe(512);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Current behavior is to coerce values to integers.
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedWithStrings = b.copy(c, "0", "0", "512");
  expect(copiedWithStrings).toBe(512);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Floats will be converted to integers via `Math.floor`
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedWithFloat = b.copy(c, 0, 0, 512.5);
  expect(copiedWithFloat).toBe(512);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Copy c into b, without specifying sourceEnd
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedWithoutSourceEnd = c.copy(b, 0, 0);
  expect(copiedWithoutSourceEnd).toBe(c.length);
  for (let i = 0; i < c.length; i++) {
    expect(b[i]).toBe(c[i]);
  }

  // Copy c into b, without specifying sourceStart
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedWithoutSourceStart = c.copy(b, 0);
  expect(copiedWithoutSourceStart).toBe(c.length);
  for (let i = 0; i < c.length; i++) {
    expect(b[i]).toBe(c[i]);
  }

  // Copied source range greater than source length
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedWithGreaterRange = c.copy(b, 0, 0, c.length + 1);
  expect(copiedWithGreaterRange).toBe(c.length);
  for (let i = 0; i < c.length; i++) {
    expect(b[i]).toBe(c[i]);
  }

  // Copy longer buffer b to shorter c without targetStart
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedLongerToShorter = b.copy(c);
  expect(copiedLongerToShorter).toBe(c.length);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Copy starting near end of b to c
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedNearEnd = b.copy(c, 0, b.length - Math.floor(c.length / 2));
  expect(copiedNearEnd).toBe(Math.floor(c.length / 2));
  for (let i = 0; i < Math.floor(c.length / 2); i++) {
    expect(c[i]).toBe(b[b.length - Math.floor(c.length / 2) + i]);
  }
  for (let i = Math.floor(c.length / 2) + 1; i < c.length; i++) {
    expect(c[c.length - 1]).toBe(c[i]);
  }

  // Try to copy 513 bytes, and check we don't overrun c
  b.fill(++cntr);
  c.fill(++cntr);
  const copiedOverrun = b.copy(c, 0, 0, 513);
  expect(copiedOverrun).toBe(c.length);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Copy 768 bytes from b into b
  b.fill(++cntr);
  b.fill(++cntr, 256);
  const copiedIntoSelf = b.copy(b, 0, 256, 1024);
  expect(copiedIntoSelf).toBe(768);
  for (let i = 0; i < b.length; i++) {
    expect(b[i]).toBe(cntr);
  }

  // Copy string longer than buffer length (failure will segfault)
  const bb = Buffer.allocUnsafe(10);
  bb.fill("hello crazy world");

  // Try to copy from before the beginning of b. Should not throw.
  expect(() => b.copy(c, 0, 100, 10)).not.toThrow();

  // Throw with invalid source type
  expect(() => Buffer.prototype.copy.call(0)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS", //TODO:"ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  // Copy throws at negative targetStart
  expect(() => Buffer.allocUnsafe(10).copy(Buffer.allocUnsafe(5), -1, 0)).toThrow({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: `The value of "targetStart" is out of range. It must be >= 0 and <= 5. Received -1`,
  });

  // Copy throws at negative sourceStart
  expect(() => Buffer.allocUnsafe(10).copy(Buffer.allocUnsafe(5), 0, -1)).toThrow({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: `The value of "sourceStart" is out of range. It must be >= 0 and <= 10. Received -1`,
  });

  // Copy throws if sourceStart is greater than length of source
  expect(() => Buffer.allocUnsafe(10).copy(Buffer.allocUnsafe(5), 0, 100)).toThrow({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: `The value of "sourceStart" is out of range. It must be >= 0 and <= 10. Received 100`,
  });

  // Check sourceEnd resets to targetEnd if former is greater than the latter
  b.fill(++cntr);
  c.fill(++cntr);
  b.copy(c, 0, 0, 1025);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(b[i]);
  }

  // Throw with negative sourceEnd
  expect(() => b.copy(c, 0, 0, -1)).toThrow({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: `The value of "sourceEnd" is out of range. It must be >= 0 and <= 1024. Received -1`,
  });

  // When sourceStart is greater than sourceEnd, zero copied
  expect(b.copy(c, 0, 100, 10)).toBe(0);

  // When targetStart > targetLength, zero copied
  expect(b.copy(c, 512, 0, 10)).toBe(0);

  // Test that the `target` can be a Uint8Array.
  const d = new Uint8Array(c);
  // copy 512 bytes, from 0 to 512.
  b.fill(++cntr);
  d.fill(++cntr);
  const copiedToUint8Array = b.copy(d, 0, 0, 512);
  expect(copiedToUint8Array).toBe(512);
  for (let i = 0; i < d.length; i++) {
    expect(d[i]).toBe(b[i]);
  }

  // Test that the source can be a Uint8Array, too.
  const e = new Uint8Array(b);
  // copy 512 bytes, from 0 to 512.
  e.fill(++cntr);
  c.fill(++cntr);
  const copiedFromUint8Array = Buffer.prototype.copy.call(e, c, 0, 0, 512);
  expect(copiedFromUint8Array).toBe(512);
  for (let i = 0; i < c.length; i++) {
    expect(c[i]).toBe(e[i]);
  }

  // https://github.com/nodejs/node/issues/23668: Do not crash for invalid input.
  c.fill("c");
  b.copy(c, "not a valid offset");
  // Make sure this acted like a regular copy with `0` offset.
  expect(c).toEqual(b.slice(0, c.length));

  c.fill("C");
  expect(c.toString()).toBe("C".repeat(c.length));
  expect(() => {
    b.copy(c, {
      [Symbol.toPrimitive]() {
        throw new Error("foo");
      },
    });
  }).toThrow("foo");
  // No copying took place:
  expect(c.toString()).toBe("C".repeat(c.length));
});

//<#END_FILE: test-buffer-copy.js
