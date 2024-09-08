//#FILE: test-heap-prof-exec-argv.js
//#SHA1: 77c3a447116b06f03f52fd56efe928699ba6d60d
//-----------------
"use strict";

// Tests --heap-prof generates a heap profile from worker
// when execArgv is set.

const fixtures = require("../common/fixtures");
const assert = require("assert");
const { spawnSync } = require("child_process");
const tmpdir = require("../common/tmpdir");
const { getHeapProfiles, verifyFrames } = require("../common/prof");

// Skip the test if inspector is disabled
const isInspectorEnabled = process.execArgv.some(arg => arg.startsWith("--inspect"));
if (!isInspectorEnabled) {
  test.skip("Inspector is disabled", () => {});
} else {
  test("--heap-prof generates a heap profile from worker when execArgv is set", () => {
    tmpdir.refresh();
    const output = spawnSync(process.execPath, [fixtures.path("workload", "allocation-worker-argv.js")], {
      cwd: tmpdir.path,
      env: {
        ...process.env,
        HEAP_PROF_INTERVAL: "128",
      },
    });

    if (output.status !== 0) {
      console.log(output.stderr.toString());
    }

    expect(output.status).toBe(0);

    const profiles = getHeapProfiles(tmpdir.path);
    expect(profiles.length).toBe(1);

    verifyFrames(output, profiles[0], "runAllocation");
  });
}

//<#END_FILE: test-heap-prof-exec-argv.js
