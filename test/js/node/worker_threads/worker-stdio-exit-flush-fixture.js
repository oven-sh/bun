"use strict";
const { Worker } = require("worker_threads");

const w = new Worker(
  `require("worker_threads");
   process.on("exit", () => {
     process.stdout.write(" ");
     process.stdout.write("world");
   });
   process.stdout.write("hello");`,
  { eval: true, stdout: true, stderr: true },
);
let data = "";
w.stdout.setEncoding("utf8");
w.stdout.on("data", c => {
  data += c;
});
w.on("exit", code => {
  console.log(data);
  if (code !== 0 || data !== "hello world") process.exit(1);
});
