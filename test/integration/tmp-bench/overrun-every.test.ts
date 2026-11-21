import { bench } from "./run";
bench("overrun.js", "every", "2 ms,50 ms,30 ms", ";17=0;20=0;20=8;21=1000000", "3");
