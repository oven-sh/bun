//#FILE: test-child-process-flush-stdio.js
//#SHA1: 42d6ab8508587f13b81d2ec70d28fd88efe8fe05
//-----------------
"use strict";

const cp = require("child_process");

// Windows' `echo` command is a built-in shell command and not an external
// executable like on *nix
const opts = { shell: process.platform === "win32" };

test("spawn echo without arguments", done => {
  const p = cp.spawn("echo", [], opts);

  p.on("close", (code, signal) => {
    expect(code).toBe(0);
    expect(signal).toBeNull();
    done();
  });

  p.stdout.read();
});

test("spawn echo with argument", done => {
  const buffer = [];
  const p = cp.spawn("echo", ["123"], opts);

  p.on("close", (code, signal) => {
    expect(code).toBe(0);
    expect(signal).toBeNull();
    expect(Buffer.concat(buffer).toString().trim()).toBe("123");
    done();
  });

  p.stdout.on("readable", () => {
    let buf;
    while ((buf = p.stdout.read()) !== null) buffer.push(buf);
  });
});

//<#END_FILE: test-child-process-flush-stdio.js
