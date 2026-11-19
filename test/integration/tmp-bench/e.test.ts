import { bench } from "./run";
bench(
  "cpu.js",
  "64 B,128 B,every 20,every 40,http 8 MB body,keep-alive x16,server k=64,named pipe stream",
  ";0=10000;0=20000;0=40000;0=20000,4=20000",
);
