import { bench } from "./run";
bench("cond.js", "4", "50 ms turns,setTimeout,http keep-alive x16,http server k=64", ";17=0;21=1000000", "5");
