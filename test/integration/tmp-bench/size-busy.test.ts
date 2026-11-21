import { bench } from "./run";
bench(
  "cond.js",
  "busy",
  "at once,Bun.file.stream,FileSink,createReadStream,dns,bursts,Bun.write file",
  ";BUN_TMP_RING=1;BUN_TMP_RING=2;BUN_TMP_RING=01;BUN_TMP_RING=21",
  "3",
);
