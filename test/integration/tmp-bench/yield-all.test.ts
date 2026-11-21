import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "50 ms turns,setTimeout,setImmediate,http keep-alive x16,http server k=64,ipc paced",
  ";17=1",
  "5",
);
