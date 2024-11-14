//#FILE: test-stdin-script-child-option.js
//#SHA1: 80d38c88249e1ceb4ef9b029e6910c91dd08ccc5
//-----------------
"use strict";

const { spawn } = require("child_process");

test("child process receives option from command line", done => {
  const expected = "--option-to-be-seen-on-child";
  const child = spawn(process.execPath, ["-", expected], { stdio: "pipe" });

  child.stdin.end("console.log(process.argv[2])");

  let actual = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => (actual += chunk));
  child.stdout.on("end", () => {
    expect(actual.trim()).toBe(expected);
    done();
  });
});

//<#END_FILE: test-stdin-script-child-option.js
