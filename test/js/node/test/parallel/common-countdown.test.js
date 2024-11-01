//#FILE: test-common-countdown.js
//#SHA1: ba753878e7b8cbeaede6057bc05a7d3b542949a5
//-----------------
"use strict";

const assert = require("assert");
const Countdown = require("../common/countdown");
const fixtures = require("../common/fixtures");
const { execFile } = require("child_process");

test("Countdown functionality", () => {
  let done = "";
  const countdown = new Countdown(2, () => (done = true));
  expect(countdown.remaining).toBe(2);
  countdown.dec();
  expect(countdown.remaining).toBe(1);
  countdown.dec();
  expect(countdown.remaining).toBe(0);
  expect(done).toBe(true);
});

const failFixtures = [
  [fixtures.path("failcounter.js"), "Mismatched <anonymous> function calls. Expected exactly 1, actual 0."],
];

test.each(failFixtures)("Fail fixture: %s", async (file, expected) => {
  await new Promise(resolve => {
    execFile(process.argv[0], [file], (ex, stdout, stderr) => {
      expect(ex).toBeTruthy();
      expect(stderr).toBe("");
      const firstLine = stdout.split("\n").shift();
      expect(firstLine).toBe(expected);
      resolve();
    });
  });
});

//<#END_FILE: test-common-countdown.js
