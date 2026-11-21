import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "at once,bursts,dns,fs.read one,promises open,Bun.file.text,open + close one,FileSink",
  "before;",
  "3",
);
