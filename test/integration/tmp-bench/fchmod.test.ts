import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "Bun.write 512,fs.read one,fs.read 4 MB,promises open,Bun.file.text,open + close one",
  ";BUN_TMP_RING=1;BUN_TMP_RING=2;BUN_TMP_RING=01;BUN_TMP_RING=21",
  "3",
);
