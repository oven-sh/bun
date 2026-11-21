import { bench } from "./run";
bench(
  "cond.js",
  "busy",
  "stdout 64K writes,stdout buffered,process.stdout,named pipe stream,50 ms turns",
  ";18=131072;18=131072,15=1;18=131072,19=131072;18=262144",
  "3",
);
