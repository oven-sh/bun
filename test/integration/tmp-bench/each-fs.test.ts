import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "fs.read,promises open+read+close,file.stream,promises.stat,open + close one,dns 127",
  ";0=0;1=0;0=0,1=0",
  "5",
);
