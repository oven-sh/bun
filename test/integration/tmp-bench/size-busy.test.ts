import { bench } from "./run";
bench(
  "cond.js",
  "busy",
  "stdout 64K writes,stdout buffered,process.stdout,named pipe,stdin,stdio ping-pong,ipc,spawnSync",
  "",
  "3",
);
