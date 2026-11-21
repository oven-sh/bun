import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "fs.read,promises,Bun.file,Bun.write,FileSink,createReadStream,dns,open + close one,open + close,worker burst,fs.watch",
  "before;",
  "3",
);
