// Reads eight lines from the console with the blocking Web dialogs and records
// what came back. alert() and confirm() read stdin one byte at a time, prompt()
// through a 4 KiB buffer, so the same console input is read both ways.
const { writeFileSync } = require("node:fs");

alert("first line is discarded by alert()");
const result = {
  stdinIsTTY: require("node:tty").isatty(0),
  prompt1: prompt("p1"),
  confirm: confirm("c"),
  prompt2: prompt("p2"),
  prompt3: prompt("p3"),
  prompt4: prompt("p4"),
  prompt5: prompt("p5"),
  prompt6: prompt("p6"),
};
writeFileSync(process.env.CONSOLE_STDIN_RESULT, JSON.stringify(result));
