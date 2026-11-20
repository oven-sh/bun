import { bench } from "./run";
bench(
  "cond.js",
  "all",
  "stdin buffer,stdin sink,stdio ping-pong",
  ";12=0;12=0,8=1048576;12=65536;12=1048576;16=1048576;16=67108864;16=1073741824",
  "5",
);
