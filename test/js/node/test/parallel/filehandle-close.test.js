//#FILE: test-filehandle-close.js
//#SHA1: e559b3eff2625475d5929e9f64c7b45724448a3b
//-----------------
"use strict";

const fs = require("fs");

// Test that using FileHandle.close to close an already-closed fd fails
// with EBADF.

test("FileHandle.close on already-closed fd fails with EBADF", async () => {
  const fh = await fs.promises.open(__filename);
  fs.closeSync(fh.fd);

  await expect(fh.close()).rejects.toMatchObject({
    code: "EBADF",
    syscall: "close",
    message: expect.any(String),
  });
});

//<#END_FILE: test-filehandle-close.js
