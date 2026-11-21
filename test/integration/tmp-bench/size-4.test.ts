import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "stdout 64K writes,stdout buffered,process.stdout,named pipe ping,named pipe stream,stdin,stdio ping-pong,ipc,spawnSync pipes",
  "before;",
  "3",
);
