//#FILE: test-readline-position.js
//#SHA1: 652d50a766a0728968f155ca650ff2ba9f5c32a8
//-----------------
"use strict";
const { PassThrough } = require("stream");
const readline = require("readline");

const ctrlU = { ctrl: true, name: "u" };

// Skip test if running in a dumb terminal
const isDumbTerminal = process.env.TERM === "dumb";
if (isDumbTerminal) {
  test.skip("Skipping test in dumb terminal", () => {});
} else {
  describe("readline position", () => {
    let input;
    let rl;

    beforeEach(() => {
      input = new PassThrough();
      rl = readline.createInterface({
        terminal: true,
        input: input,
        prompt: "",
      });
    });

    afterEach(() => {
      rl.close();
    });

    test.each([
      [1, "a"],
      [2, "ab"],
      [2, "丁"],
      [0, "\u0301"], // COMBINING ACUTE ACCENT
      [1, "a\u0301"], // á
      [0, "\u20DD"], // COMBINING ENCLOSING CIRCLE
      [2, "a\u20DDb"], // a⃝b
      [0, "\u200E"], // LEFT-TO-RIGHT MARK
    ])('cursor position for "%s" should be %i', (expectedCursor, string) => {
      rl.write(string);
      expect(rl.getCursorPos().cols).toBe(expectedCursor);
      rl.write(null, ctrlU);
    });
  });
}

//<#END_FILE: test-readline-position.js
