import { bench } from "./run";
bench(
  "cond.js",
  "busy",
  "child stdout buffered,128 B,child stdin buffer,lines into,stdio ping,ipc ping",
  "before;",
  "3",
);
