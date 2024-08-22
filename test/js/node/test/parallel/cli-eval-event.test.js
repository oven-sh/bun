//#FILE: test-cli-eval-event.js
//#SHA1: d64fa25056a9ecf2e87e46560d477b42d3e32909
//-----------------
"use strict";

const { spawn } = require("child_process");

test("CLI eval event", () => {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      "-e",
      `
      const server = require('net').createServer().listen(0);
      server.once('listening', server.close);
    `,
    ]);

    child.once("exit", (exitCode, signalCode) => {
      expect(exitCode).toBe(0);
      expect(signalCode).toBeNull();
      resolve();
    });
  });
});

//<#END_FILE: test-cli-eval-event.js
