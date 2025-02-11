import { expect, test } from "bun:test";

test("write(value >= 0x80)", () => {
  const buffer = Buffer.alloc(1);
  buffer.write("\x80", "binary");
  expect(buffer[0]).toBe(0x80);
});
