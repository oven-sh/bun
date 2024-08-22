//#FILE: test-process-initgroups.js
//#SHA1: e7321b3005c066a0b2edbe457e695622b9f2b8e9
//-----------------
"use strict";

if (process.platform === "win32") {
  test("process.initgroups is undefined on Windows", () => {
    expect(process.initgroups).toBeUndefined();
  });
} else if (typeof process.initgroups !== "undefined") {
  describe("process.initgroups", () => {
    test("throws TypeError for invalid user argument", () => {
      [undefined, null, true, {}, [], () => {}].forEach(val => {
        expect(() => {
          process.initgroups(val);
        }).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: expect.stringContaining('The "user" argument must be one of type number or string.'),
          }),
        );
      });
    });

    test("throws TypeError for invalid extraGroup argument", () => {
      [undefined, null, true, {}, [], () => {}].forEach(val => {
        expect(() => {
          process.initgroups("foo", val);
        }).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: expect.stringContaining('The "extraGroup" argument must be one of type number or string.'),
          }),
        );
      });
    });

    test("throws ERR_UNKNOWN_CREDENTIAL for non-existent group", () => {
      expect(() => {
        process.initgroups("fhqwhgadshgnsdhjsdbkhsdabkfabkveyb", "fhqwhgadshgnsdhjsdbkhsdabkfabkveyb");
      }).toThrow(
        expect.objectContaining({
          code: "ERR_UNKNOWN_CREDENTIAL",
          message: expect.stringContaining("Group identifier does not exist"),
        }),
      );
    });
  });
}

//<#END_FILE: test-process-initgroups.js
