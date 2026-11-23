import { bench } from "./run";
bench("cond.js", "all", "fs.read,fs.write,x32,bursts of 32,Bun.write,stdio ping,child stdin", "before;", "7");
