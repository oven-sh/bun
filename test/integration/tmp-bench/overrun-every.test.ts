import { bench } from "./run";
bench("cond.js", "busy", "bursts of 32,Bun.write 512 KB$,child stdin buffer,ipc ping", "before;", "5");
