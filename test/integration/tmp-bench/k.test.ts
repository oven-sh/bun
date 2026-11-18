import { bench } from "./run";
bench(
  "tune.js",
  "turns,stdout 64K,stdout 128,stdout buffered,named pipe stream",
  ";4=262144;4=1048576,12=1048576;9=2;10=8000000;7=50000;7=50000,8=1;7=200000,8=1;7=50000,8=1,4=262144;7=50000,8=1,4=1048576,12=1048576,9=2",
);
