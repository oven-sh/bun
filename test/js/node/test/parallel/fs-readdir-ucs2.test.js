//#FILE: test-fs-readdir-ucs2.js
//#SHA1: 28e908f58600a16cdd2335ab4ca7fe4a89e478d6
//-----------------
"use strict";

const path = require("path");
const fs = require("fs");

const tmpdir = require("../common/tmpdir");

// Skip test if not on Linux
if (process.platform !== "linux") {
  test.skip("Test is linux specific.", () => {});
} else {
  beforeAll(() => {
    tmpdir.refresh();
  });

  test("fs.readdir with UCS2 encoding", async () => {
    const filename = "\uD83D\uDC04";
    const root = Buffer.from(`${tmpdir.path}${path.sep}`);
    const filebuff = Buffer.from(filename, "ucs2");
    const fullpath = Buffer.concat([root, filebuff]);

    try {
      fs.closeSync(fs.openSync(fullpath, "w+"));
    } catch (e) {
      if (e.code === "EINVAL") {
        return test.skip("test requires filesystem that supports UCS2");
      }
      throw e;
    }

    await new Promise((resolve, reject) => {
      fs.readdir(tmpdir.path, "ucs2", (err, list) => {
        if (err) reject(err);
        else resolve(list);
      });
    }).then(list => {
      expect(list.length).toBe(1);
      const fn = list[0];
      expect(Buffer.from(fn, "ucs2")).toEqual(filebuff);
      expect(fn).toBe(filename);
    });
  });
}

//<#END_FILE: test-fs-readdir-ucs2.js
