import { bench } from "./run";
bench("cond.js", "busy", "Bun.write 512 KB$,writer() one,bursts of 32,fs.read one,open + close one", "before;", "3");
