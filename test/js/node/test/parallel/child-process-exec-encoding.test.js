//#FILE: test-child-process-exec-encoding.js
//#SHA1: 3ad6878126678aa6ad2c38a43264e5684dae6a72
//-----------------
"use strict";

const stdoutData = "foo";
const stderrData = "bar";

if (process.argv[2] === "child") {
  // The following console calls are part of the test.
  console.log(stdoutData);
  console.error(stderrData);
} else {
  const cp = require("child_process");
  const expectedStdout = `${stdoutData}\n`;
  const expectedStderr = `${stderrData}\n`;

  function run(options) {
    const cmd = `"${process.execPath}" "${__filename}" child`;

    return new Promise((resolve, reject) => {
      cp.exec(cmd, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  test("Test default encoding, which should be utf8", async () => {
    const { stdout, stderr } = await run({});
    expect(typeof stdout).toBe("string");
    expect(typeof stderr).toBe("string");
    expect(stdout).toBe(expectedStdout);
    expect(stderr).toBe(expectedStderr);
  });

  test("Test explicit utf8 encoding", async () => {
    const { stdout, stderr } = await run({ encoding: "utf8" });
    expect(typeof stdout).toBe("string");
    expect(typeof stderr).toBe("string");
    expect(stdout).toBe(expectedStdout);
    expect(stderr).toBe(expectedStderr);
  });

  test("Test cases that result in buffer encodings", async () => {
    const encodings = [undefined, null, "buffer", "invalid"];

    for (const encoding of encodings) {
      const { stdout, stderr } = await run({ encoding });
      expect(stdout).toBeInstanceOf(Buffer);
      expect(stderr).toBeInstanceOf(Buffer);
      expect(stdout.toString()).toBe(expectedStdout);
      expect(stderr.toString()).toBe(expectedStderr);
    }
  });
}

//<#END_FILE: test-child-process-exec-encoding.js
