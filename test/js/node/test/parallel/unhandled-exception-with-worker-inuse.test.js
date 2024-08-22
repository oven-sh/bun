//#FILE: test-unhandled-exception-with-worker-inuse.js
//#SHA1: 4eb89fdb9d675dbef4f89ed61ab77225b9200b4a
//-----------------
"use strict";

// https://github.com/nodejs/node/issues/45421
//
// Check that node will NOT call v8::Isolate::SetIdle() when exiting
// due to an unhandled exception, otherwise the assertion(enabled in
// debug build only) in the SetIdle(), which checks that the vm state
// is either EXTERNAL or IDLE will fail.
//
// The root cause of this issue is that before PerIsolateMessageListener()
// is invoked by v8, v8 preserves the JS vm state, although it should
// switch to EXTERNEL. https://bugs.chromium.org/p/v8/issues/detail?id=13464
//
// Therefore, this commit can be considered as an workaround of the v8 bug,
// but we also find it not useful to call SetIdle() when terminating.

if (process.argv[2] === "child") {
  const { Worker } = require("worker_threads");
  new Worker("", { eval: true });
  throw new Error("xxx");
} else {
  const { spawnSync } = require("child_process");

  test("unhandled exception with worker in use", () => {
    const result = spawnSync(process.execPath, [__filename, "child"]);

    const stderr = result.stderr.toString().trim();
    // Expect error message to be preserved
    expect(stderr).toMatch(/xxx/);
    // Expect no crash
    expect(result.status).not.toBe(null);
    expect(result.signal).toBe(null);
  });
}

//<#END_FILE: test-unhandled-exception-with-worker-inuse.js
