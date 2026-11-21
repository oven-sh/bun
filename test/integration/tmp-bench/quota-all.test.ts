import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "50 ms turns,stdout 64K writes,stdout buffered,process.stdout",
  ";BUN_TMP_QUOTA=262144;BUN_TMP_QUOTA=524288;BUN_TMP_QUOTA=1048576;3=0,BUN_TMP_QUOTA=524288",
  "3",
);
