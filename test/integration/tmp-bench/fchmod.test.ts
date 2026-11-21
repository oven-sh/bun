import { bench } from "./run";
bench(
  "cond.js",
  "4",
  "fs.read,promises,Bun.file,Bun.write,FileSink,createReadStream,dns,open + close,setTimeout,setImmediate,fs.watch",
  "",
  "3",
);
