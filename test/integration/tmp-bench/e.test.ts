import { bench } from "./run";
bench(
  "cpu.js",
  "every 12,every 16,every 20 ,every 28,server k=64,keep-alive x16",
  ";0=0;0=10000;0=30000;1=20000;0=30000,1=20000",
  "3",
);
