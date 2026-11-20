import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "stdout 64K writes,process.stdout,50 ms turns,named pipe stream",
  ";10=1;3=0;9=0;10=1,3=0;10=1,3=0,9=0;0=0,1=0,2=0,3=0,9=0",
);
