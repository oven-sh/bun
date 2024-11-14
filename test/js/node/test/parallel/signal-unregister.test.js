//#FILE: test-signal-unregister.js
//#SHA1: 44f7b12e1cb3d5e2bc94cb244f52d5a6a591d8f4
//-----------------
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const fixturesPath = path.resolve(__dirname, "..", "fixtures");

test("Child process exits on SIGINT", () => {
  const child = spawn(process.argv[0], [path.join(fixturesPath, "should_exit.js")]);

  return new Promise(resolve => {
    child.stdout.once("data", () => {
      child.kill("SIGINT");
    });

    child.on("exit", (exitCode, signalCode) => {
      expect(exitCode).toBeNull();
      expect(signalCode).toBe("SIGINT");
      resolve();
    });
  });
});

//<#END_FILE: test-signal-unregister.js
