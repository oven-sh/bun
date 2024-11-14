//#FILE: test-memory-usage-emfile.js
//#SHA1: 062c0483d1da90d9e08bab6a7d006d2da5861bd9
//-----------------
"use strict";

// On IBMi, the rss memory always returns zero
if (process.platform === "os400") {
  test.skip("On IBMi, the rss memory always returns zero", () => {});
} else {
  const fs = require("fs");

  test("memory usage with many open files", () => {
    const files = [];

    while (files.length < 256) files.push(fs.openSync(__filename, "r"));

    const r = process.memoryUsage.rss();
    expect(r).toBeGreaterThan(0);

    // Clean up opened files
    files.forEach(fd => fs.closeSync(fd));
  });
}

//<#END_FILE: test-memory-usage-emfile.js
