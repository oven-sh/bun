//#FILE: test-fs-readfile-eof.js
//#SHA1: 89b7efe6c30d2316249bfae1d01f16f97e32be04
//-----------------
"use strict";

const fs = require("fs/promises");
const { exec } = require("child_process");

const childType = ["child-encoding", "child-non-encoding"];

if (process.argv[2] === childType[0]) {
  fs.readFile("/dev/stdin", "utf8").then(data => {
    process.stdout.write(data);
  });
} else if (process.argv[2] === childType[1]) {
  fs.readFile("/dev/stdin").then(data => {
    process.stdout.write(data);
  });
} else {
  const data1 = "Hello";
  const data2 = "World";
  const expected = `${data1}\n${data2}\n`;

  const f = JSON.stringify(__filename);
  const node = JSON.stringify(process.execPath);

  function testReadFile(child) {
    return new Promise((resolve, reject) => {
      const cmd = `(echo ${data1}; sleep 0.5; echo ${data2}) | ${node} ${f} ${child}`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    });
  }

  if (process.platform === "win32" || process.platform === "aix" || process.platform === "os400") {
    test.skip(`No /dev/stdin on ${process.platform}.`, () => {});
  } else {
    test("readFile with encoding", async () => {
      const { stdout, stderr } = await testReadFile(childType[0]);
      expect(stdout).toBe(expected);
      expect(stderr).toBe("");
    });

    test("readFile without encoding", async () => {
      const { stdout, stderr } = await testReadFile(childType[1]);
      expect(stdout).toBe(expected);
      expect(stderr).toBe("");
    });
  }
}

//<#END_FILE: test-fs-readfile-eof.js
