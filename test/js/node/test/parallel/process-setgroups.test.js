//#FILE: test-process-setgroups.js
//#SHA1: 8fe1c3ec36e208d67f92c9d1325b228cb3f46312
//-----------------
"use strict";

if (process.platform === "win32") {
  test("process.setgroups is undefined on Windows", () => {
    expect(process.setgroups).toBeUndefined();
  });
} else if (typeof process.isMainThread !== "undefined" && !process.isMainThread) {
  // Skip tests in non-main threads
} else {
  describe("process.setgroups", () => {
    test("throws TypeError when called without arguments", () => {
      expect(() => {
        process.setgroups();
      }).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.stringContaining('The "groups" argument must be an instance of Array'),
        }),
      );
    });

    test("throws RangeError for invalid group ID", () => {
      expect(() => {
        process.setgroups([1, -1]);
      }).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
        }),
      );
    });

    // [], https://github.com/oven-sh/bun/issues/11793
    test.each([undefined, null, true, {}, () => {}])("throws TypeError for invalid group type: %p", val => {
      expect(() => {
        process.setgroups([val]);
      }).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.stringContaining('The "groups[0]" argument must be of type number or string'),
        }),
      );
    });

    test("throws ERR_UNKNOWN_CREDENTIAL for non-existent group", () => {
      expect(() => {
        process.setgroups([1, "fhqwhgadshgnsdhjsdbkhsdabkfabkveyb"]);
      }).toThrow(
        expect.objectContaining({
          code: "ERR_UNKNOWN_CREDENTIAL",
          message: "Group identifier does not exist: fhqwhgadshgnsdhjsdbkhsdabkfabkveyb",
        }),
      );
    });
  });
}

//<#END_FILE: test-process-setgroups.js
