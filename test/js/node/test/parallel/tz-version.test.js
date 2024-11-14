//#FILE: test-tz-version.js
//#SHA1: 7c06414dda474dff448a3998499dddffdf084126
//-----------------
"use strict";

// Skip the test if Intl is not available
if (typeof Intl === "undefined") {
  test.skip("missing Intl", () => {});
} else {
  // Refs: https://github.com/nodejs/node/blob/1af63a90ca3a59ca05b3a12ad7dbea04008db7d9/configure.py#L1694-L1711
  if (process.config.variables.icu_path !== "deps/icu-small") {
    // If Node.js is configured to use its built-in ICU, it uses a strict subset
    // of ICU formed using `tools/icu/shrink-icu-src.py`, which is present in
    // `deps/icu-small`. It is not the same as configuring the build with
    // `./configure --with-intl=small-icu`. The latter only uses a subset of the
    // locales, i.e., it uses the English locale, `root,en`, by default and other
    // locales can also be specified using the `--with-icu-locales` option.
    test.skip("not using the icu data file present in deps/icu-small/source/data/in/icudt##l.dat.bz2", () => {});
  } else {
    const { readFileSync } = require("fs");
    const path = require("path");

    // This test ensures the correctness of the automated timezone upgrade PRs.

    test("timezone version matches expected version", () => {
      const expectedVersion = readFileSync(path.join(__dirname, "fixtures", "tz-version.txt"), "utf8").trim();
      expect(process.versions.tz).toBe(expectedVersion);
    });
  }
}

//<#END_FILE: test-tz-version.js
