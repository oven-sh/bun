//#FILE: test-child-process-exec-std-encoding.js
//#SHA1: fa74583780f5256e46fd7a5ad02aed4b20bb0b76
//-----------------
"use strict";

const cp = require("child_process");

const stdoutData = "foo";
const stderrData = "bar";
const expectedStdout = `${stdoutData}\n`;
const expectedStderr = `${stderrData}\n`;

if (process.argv[2] === "child") {
  // The following console calls are part of the test.
  console.log(stdoutData);
  console.error(stderrData);
} else {
  test("child process exec with stdout and stderr encoding", done => {
    const cmd = `"${process.execPath}" "${__filename}" child`;
    const child = cp.exec(cmd, (error, stdout, stderr) => {
      expect(error).toBeNull();
      expect(stdout).toBe(expectedStdout);
      expect(stderr).toBe(expectedStderr);
      done();
    });
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
  });
}

//<#END_FILE: test-child-process-exec-std-encoding.js
