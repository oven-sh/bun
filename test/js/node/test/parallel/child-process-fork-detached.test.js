//#FILE: test-child-process-fork-detached.js
//#SHA1: 289d7a5f7c5d58ae50a06e7427730c57d78fe39c
//-----------------
"use strict";

const { fork } = require("child_process");
const path = require("path");

const fixturesPath = path.resolve(__dirname, "..", "fixtures");

test("fork detached child process", done => {
  const nonPersistentNode = fork(path.join(fixturesPath, "parent-process-nonpersistent-fork.js"), [], { silent: true });

  let childId = -1;

  nonPersistentNode.stdout.on("data", data => {
    childId = parseInt(data, 10);
    nonPersistentNode.kill();
  });

  nonPersistentNode.on("exit", () => {
    expect(childId).not.toBe(-1);

    // Killing the child process should not throw an error
    expect(() => process.kill(childId)).not.toThrow();

    done();
  });
});

//<#END_FILE: test-child-process-fork-detached.js
