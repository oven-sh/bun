import { bench } from "./run";
bench(
  "cond.js",
  "busy",
  "fs.read,promises,Bun.file,Bun.write,FileSink,createReadStream,dns,open + close one,fs.watch",
  "before;",
  "3",
);
