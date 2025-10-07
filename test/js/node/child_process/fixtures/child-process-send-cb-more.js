// more comprehensive version of test-child-process-send-cb

"use strict";
const fork = require("child_process").fork;

if (process.argv[2] === "child") {
  console.log("send simple");
  process.send("simple", err => {
    console.log("cb simple", err);
  });
  console.log("send ok.repeat(16384)");
  process.send("ok".repeat(16384), err => {
    console.log("cb ok.repeat(16384)", err);
  });
  console.log("send 2");
  process.send("2", err => {
    console.log("cb 2", err);
  });
  console.log("send 3");
  process.send("3", err => {
    console.log("cb 3", err);
  });
  console.log("send 4");
  process.send("4", err => {
    console.log("cb 4", err);
  });
  console.log("send 5");
  process.send("5", err => {
    console.log("cb 5", err);
    console.log("send 6");
    process.send("6", err => {
      // interestingly, node will call this callback before the outer callbacks are done being called
      console.log("cb 6", err);
    });
    console.log("send 7");
    process.send("ok".repeat(16384), err => {
      console.log("cb 7", err);
    });
  });
} else {
  const child = fork(process.argv[1], ["child"], {
    // env: {
    //   ...process.env,
    //   "BUN_DEBUG": "out2",
    // },
  });
  child.on("message", message => {
    console.error("parent got message", JSON.stringify(message).replace("ok".repeat(16384), "ok…ok"));
  });
  child.on("exit", (exitCode, signalCode) => {
    console.error(`parent got exit event ${exitCode} ${signalCode}`);
  });
}
