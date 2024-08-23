//#FILE: test-preload-self-referential.js
//#SHA1: 24bb3def0bae68082aee5280abc5116ebd81c972
//-----------------
"use strict";

const path = require("path");
const { exec } = require("child_process");

const nodeBinary = process.argv[0];

// Skip test if not in main thread
if (typeof Worker !== "undefined") {
  test.skip("process.chdir is not available in Workers", () => {});
} else {
  test("self-referential module preload", done => {
    const selfRefModule = path.join(__dirname, "..", "fixtures", "self_ref_module");
    const fixtureA = path.join(__dirname, "..", "fixtures", "printA.js");

    exec(`"${nodeBinary}" -r self_ref "${fixtureA}"`, { cwd: selfRefModule }, (err, stdout, stderr) => {
      expect(err).toBeFalsy();
      expect(stdout).toBe("A\n");
      done();
    });
  });
}

//<#END_FILE: test-preload-self-referential.js
