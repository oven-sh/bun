//#FILE: test-child-process-exec-kill-throws.js
//#SHA1: 968879ddf3244351dea40c681343ea8defc02a0b
//-----------------
"use strict";

const cp = require("child_process");

if (process.argv[2] === "child") {
  // Since maxBuffer is 0, this should trigger an error.
  console.log("foo");
} else {
  const originalKill = cp.ChildProcess.prototype.kill;

  beforeEach(() => {
    // Monkey patch ChildProcess#kill() to kill the process and then throw.
    cp.ChildProcess.prototype.kill = function () {
      originalKill.apply(this, arguments);
      throw new Error("mock error");
    };
  });

  afterEach(() => {
    // Restore original kill method
    cp.ChildProcess.prototype.kill = originalKill;
  });

  test("ChildProcess#kill() throws error", done => {
    const cmd = `"${process.execPath}" "${__filename}" child`;
    const options = { maxBuffer: 0, killSignal: "SIGKILL" };

    const child = cp.exec(cmd, options, (err, stdout, stderr) => {
      // Verify that if ChildProcess#kill() throws, the error is reported.
      expect(err).toEqual(
        expect.objectContaining({
          message: "mock error",
        }),
      );
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(child.killed).toBe(true);
      done();
    });
  });
}

//<#END_FILE: test-child-process-exec-kill-throws.js
