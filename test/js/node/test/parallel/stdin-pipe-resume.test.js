//#FILE: test-stdin-pipe-resume.js
//#SHA1: 6775f16e6a971590e3a5308d4e3678029be47411
//-----------------
"use strict";

// This tests that piping stdin will cause it to resume() as well.

const { spawn } = require("child_process");

if (process.argv[2] === "child") {
  process.stdin.pipe(process.stdout);
} else {
  test("piping stdin causes it to resume", done => {
    const buffers = [];
    const child = spawn(process.execPath, [__filename, "child"]);

    child.stdout.on("data", c => {
      buffers.push(c);
    });

    child.stdout.on("close", () => {
      const b = Buffer.concat(buffers).toString();
      expect(b).toBe("Hello, world\n");
      done();
    });

    child.stdin.write("Hel");
    child.stdin.write("lo,");
    child.stdin.write(" wo");

    setTimeout(() => {
      child.stdin.write("rld\n");
      child.stdin.end();
    }, 10);
  });
}

//<#END_FILE: test-stdin-pipe-resume.js
