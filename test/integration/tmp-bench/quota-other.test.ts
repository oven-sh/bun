import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "128 B writes,stdin buffer,stdin sink,spawn x16,300 live pipes,stdio ping,ipc paced",
  ";BUN_TMP_QUOTA=262144;BUN_TMP_QUOTA=524288;BUN_TMP_QUOTA=1048576;3=0,BUN_TMP_QUOTA=524288",
  "3",
);
