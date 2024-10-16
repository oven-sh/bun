//#FILE: test-process-release.js
//#SHA1: c1e8d1247391778d25fb0d2aeec5525fbe7d05b1
//-----------------
"use strict";

const versionParts = process.versions.node.split(".");

test("process.release properties", () => {
  expect(process.release.name).toBe("node");

  expect(process.release.lts).toBeUndefined();
});

//<#END_FILE: test-process-release.js
