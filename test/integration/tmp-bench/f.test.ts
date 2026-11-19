import { bench } from "./run";
bench(
  "cpu.js",
  "keep-alive x1$,ping-pong k=1,server k=1,echo server,one by one,stdio ping",
  ";3=16;1=100000,2=200000;1=100000,2=200000,3=16;1=75000,2=150000;1=25000",
);
