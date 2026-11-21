import { bench } from "./run";
bench("fair.js", "busy", "stream,buffered,start", ";0=0,1=0,2=0,3=0;Q=524288", "15");
