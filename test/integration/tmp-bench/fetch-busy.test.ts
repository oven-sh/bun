import { bench } from "./run";
bench("cond.js", "busy", "keep-alive x1$,worker round,128 B writes", ";0=0;4=1;0=0,1=0,2=0,3=0", "9");
