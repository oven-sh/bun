import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "stdout 64K writes,stdout buffered,process.stdout,named pipe,stdin,stdio ping-pong,ipc,spawnSync,128 B writes",
  "",
  "5",
);
