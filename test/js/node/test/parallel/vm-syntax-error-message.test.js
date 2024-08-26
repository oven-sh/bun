//#FILE: test-vm-syntax-error-message.js
//#SHA1: dbd3683e08ad5cf574d1824108446e9c425adf1b
//-----------------
"use strict";

const child_process = require("child_process");

test("vm syntax error message", done => {
  const p = child_process.spawn(process.execPath, [
    "-e",
    'vm = require("vm");' +
      "context = vm.createContext({});" +
      "try { vm.runInContext(\"throw new Error('boo')\", context); } " +
      "catch (e) { console.log(e.message); }",
  ]);

  p.stderr.on("data", () => {
    throw new Error("stderr should not receive any data");
  });

  let output = "";

  p.stdout.on("data", data => (output += data));

  p.stdout.on("end", () => {
    expect(output.replace(/[\r\n]+/g, "")).toBe("boo");
    done();
  });
});

//<#END_FILE: test-vm-syntax-error-message.js
