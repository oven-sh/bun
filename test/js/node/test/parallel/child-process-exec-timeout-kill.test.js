//#FILE: test-child-process-exec-timeout-kill.js
//#SHA1: 01bc25d258b4d8905a2387e9a08b9ceb8c38c141
//-----------------
"use strict";

// Test exec() with both a timeout and a killSignal.

const cp = require("child_process");
const path = require("path");

const { kExpiringChildRunTime, kExpiringParentTimer } = require("../common/child_process");

const logAfterTime = time => {
  setTimeout(() => {
    console.log(`Logged after ${time}ms`);
  }, time);
};

if (process.argv[2] === "child") {
  logAfterTime(kExpiringChildRunTime);
  process.exit(0);
}

const cmd = `"${process.execPath}" "${__filename}" child`;

test("exec with timeout and killSignal", done => {
  // Test with a different kill signal.
  cp.exec(
    cmd,
    {
      timeout: kExpiringParentTimer,
      killSignal: "SIGKILL",
    },
    (err, stdout, stderr) => {
      console.log("[stdout]", stdout.trim());
      console.log("[stderr]", stderr.trim());

      expect(err.killed).toBe(true);
      expect(err.code).toBeNull();
      expect(err.signal).toBe("SIGKILL");
      expect(err.cmd).toBe(cmd);
      expect(stdout.trim()).toBe("");
      expect(stderr.trim()).toBe("");
      done();
    },
  );
});

//<#END_FILE: test-child-process-exec-timeout-kill.js
