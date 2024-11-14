//#FILE: test-buffer-tostring-range.js
//#SHA1: 2bc09c70e84191e47ae345cc3178f28458b10ec2
//-----------------
"use strict";

const rangeBuffer = Buffer.from("abc");

test("Buffer.toString range behavior", () => {
  // If start >= buffer's length, empty string will be returned
  expect(rangeBuffer.toString("ascii", 3)).toBe("");
  expect(rangeBuffer.toString("ascii", +Infinity)).toBe("");
  expect(rangeBuffer.toString("ascii", 3.14, 3)).toBe("");
  expect(rangeBuffer.toString("ascii", "Infinity", 3)).toBe("");

  // If end <= 0, empty string will be returned
  expect(rangeBuffer.toString("ascii", 1, 0)).toBe("");
  expect(rangeBuffer.toString("ascii", 1, -1.2)).toBe("");
  expect(rangeBuffer.toString("ascii", 1, -100)).toBe("");
  expect(rangeBuffer.toString("ascii", 1, -Infinity)).toBe("");

  // If start < 0, start will be taken as zero
  expect(rangeBuffer.toString("ascii", -1, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", -1.99, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", -Infinity, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "-1", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "-1.99", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "-Infinity", 3)).toBe("abc");

  // If start is an invalid integer, start will be taken as zero
  expect(rangeBuffer.toString("ascii", "node.js", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", {}, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", [], 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", NaN, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", null, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", undefined, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", false, 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "", 3)).toBe("abc");

  // But, if start is an integer when coerced, then it will be coerced and used.
  expect(rangeBuffer.toString("ascii", "-1", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "1", 3)).toBe("bc");
  expect(rangeBuffer.toString("ascii", "-Infinity", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", "3", 3)).toBe("");
  expect(rangeBuffer.toString("ascii", Number(3), 3)).toBe("");
  expect(rangeBuffer.toString("ascii", "3.14", 3)).toBe("");
  expect(rangeBuffer.toString("ascii", "1.99", 3)).toBe("bc");
  expect(rangeBuffer.toString("ascii", "-1.99", 3)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 1.99, 3)).toBe("bc");
  expect(rangeBuffer.toString("ascii", true, 3)).toBe("bc");

  // If end > buffer's length, end will be taken as buffer's length
  expect(rangeBuffer.toString("ascii", 0, 5)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, 6.99)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, Infinity)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, "5")).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, "6.99")).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, "Infinity")).toBe("abc");

  // If end is an invalid integer, end will be taken as buffer's length
  expect(rangeBuffer.toString("ascii", 0, "node.js")).toBe("");
  expect(rangeBuffer.toString("ascii", 0, {})).toBe("");
  expect(rangeBuffer.toString("ascii", 0, NaN)).toBe("");
  expect(rangeBuffer.toString("ascii", 0, undefined)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0)).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, null)).toBe("");
  expect(rangeBuffer.toString("ascii", 0, [])).toBe("");
  expect(rangeBuffer.toString("ascii", 0, false)).toBe("");
  expect(rangeBuffer.toString("ascii", 0, "")).toBe("");

  // But, if end is an integer when coerced, then it will be coerced and used.
  expect(rangeBuffer.toString("ascii", 0, "-1")).toBe("");
  expect(rangeBuffer.toString("ascii", 0, "1")).toBe("a");
  expect(rangeBuffer.toString("ascii", 0, "-Infinity")).toBe("");
  expect(rangeBuffer.toString("ascii", 0, "3")).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, Number(3))).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, "3.14")).toBe("abc");
  expect(rangeBuffer.toString("ascii", 0, "1.99")).toBe("a");
  expect(rangeBuffer.toString("ascii", 0, "-1.99")).toBe("");
  expect(rangeBuffer.toString("ascii", 0, 1.99)).toBe("a");
  expect(rangeBuffer.toString("ascii", 0, true)).toBe("a");
});

test("toString() with an object as an encoding", () => {
  expect(
    rangeBuffer.toString({
      toString: function () {
        return "ascii";
      },
    }),
  ).toBe("abc");
});

test("toString() with 0 and null as the encoding", () => {
  expect(() => {
    rangeBuffer.toString(0, 1, 2);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_UNKNOWN_ENCODING",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    rangeBuffer.toString(null, 1, 2);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_UNKNOWN_ENCODING",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-buffer-tostring-range.js
