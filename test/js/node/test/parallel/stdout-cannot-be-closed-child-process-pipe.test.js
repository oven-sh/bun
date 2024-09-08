//#FILE: test-stdout-cannot-be-closed-child-process-pipe.js
//#SHA1: 405380c20ca8313c3f58109a4928d90eae9b79b9
//-----------------
"use strict";

const { spawn } = require("child_process");

if (process.argv[2] === "child") {
  process.stdout.end("foo");
} else {
  test("stdout cannot be closed in child process pipe", done => {
    const child = spawn(process.execPath, [__filename, "child"]);
    let out = "";
    let err = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", c => {
      out += c;
    });
    child.stderr.on("data", c => {
      err += c;
    });

    child.on("close", (code, signal) => {
      expect(code).toBe(0);
      expect(err).toBe("");
      expect(out).toBe("foo");
      console.log("ok");
      done();
    });
  });
}

//<#END_FILE: test-stdout-cannot-be-closed-child-process-pipe.js
