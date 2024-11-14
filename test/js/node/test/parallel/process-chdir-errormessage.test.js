//#FILE: test-process-chdir-errormessage.js
//#SHA1: d0eee0a43892b20221d341b892fa425fe207c506
//-----------------
"use strict";

// Skip test in workers where process.chdir is not available
if (typeof Worker !== "undefined") {
  test.skip("process.chdir is not available in Workers");
} else {
  test("process.chdir throws correct error for non-existent directory", () => {
    expect(() => {
      process.chdir("does-not-exist");
    }).toThrow(
      expect.objectContaining({
        name: "Error",
        code: "ENOENT",
        message: expect.stringMatching(/ENOENT: no such file or directory, chdir .+ -> 'does-not-exist'/),
        path: process.cwd(),
        syscall: "chdir",
        dest: "does-not-exist",
      }),
    );
  });
}

//<#END_FILE: test-process-chdir-errormessage.js
