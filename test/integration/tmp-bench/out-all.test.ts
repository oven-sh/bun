import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "stdout 64K writes,process.stdout,50 ms turns,stdout buffered,128 B writes,named pipe stream",
  ";14=1;15=1;3=300000;15=1,3=300000;3=1000000",
  "3",
);
