import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "fs.read,file.stream,read+close x,promises.stat,open + close one,writer() one",
  ";4=1000,5=0,6=1;4=1;0=0,1=0,2=0,3=0",
);
