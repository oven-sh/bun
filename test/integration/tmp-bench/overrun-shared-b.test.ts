import { bench } from "./run";
bench(
  "cond.js",
  "12",
  "fs.read one,promises open,Bun.file.text,createReadStream,dns.lookup,keep-alive,worker ping-pong,child stdin,stdout 64K,ipc ping",
  "before;",
  "3",
);
