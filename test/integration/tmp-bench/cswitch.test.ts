import { bench } from "./run";
bench("cswitch.js", "busy", ";0=0,1=0,2=0,3=0;15=1", "15");
