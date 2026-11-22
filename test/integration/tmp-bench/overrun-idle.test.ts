import { bench } from "./run";
bench("overrun.js", "idle", "2 ms,50 ms,3 ms,30 ms,bursts,1000 short", "before;x", "3");
