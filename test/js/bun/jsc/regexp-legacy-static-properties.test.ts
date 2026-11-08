import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// test() records where the match is. RegExp.lastMatch and the other legacy static properties run
// the match again for the captures, and that second run needs more stack than the first. When it
// fails, the read throws a RangeError. It used to end the process: "Segmentation fault at address 0x4".
// The program runs in a child, because the size of the RegExp stack is read when the process starts.
test("a legacy static property of RegExp throws when its second match runs out of stack", async () => {
  const program = `
    const string = Buffer.alloc(2000, "a").toString() + "c";
    const regExp = new RegExp("(?:(?!(?:a|b)*d)a)*c" + Buffer.alloc(1600 * 4, "(x)?").toString());
    console.log("matched: " + regExp.test(string));
    for (const name of ["lastMatch", "lastParen", "$1", "leftContext", "rightContext"]) {
      try {
        RegExp[name];
        console.log(name + ": no error");
      } catch (error) {
        console.log(name + ": " + error.constructor.name + ": " + error.message);
      }
    }
    try {
      RegExp.input = "x";
      console.log("input = x: no error");
    } catch (error) {
      console.log("input = x: " + error.constructor.name + ": " + error.message);
    }
    console.log("input is kept: " + (RegExp.input === string));
    // The next match gives the properties their values again.
    console.log("next match: " + /b(c)d/.test("abcde"));
    console.log([RegExp.lastMatch, RegExp.lastParen, RegExp.$1, RegExp.leftContext, RegExp.rightContext, RegExp.input].join(" "));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", program],
    env: { ...bunEnv, BUN_JSC_maxRegExpStackSize: "65536" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim().split("\n"), stderr }).toEqual({
    stdout: [
      "matched: true",
      "lastMatch: RangeError: Out of memory",
      "lastParen: RangeError: Out of memory",
      "$1: RangeError: Out of memory",
      "leftContext: RangeError: Out of memory",
      "rightContext: RangeError: Out of memory",
      "input = x: RangeError: Out of memory",
      "input is kept: true",
      "next match: true",
      "bcd c c a e abcde",
    ],
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
