import { bench } from "./run";
bench("cond.js", "busy", "tcp ping-pong k=1$,tcp ping-pong k=64,keep-alive x1$,keep-alive x16,server k=1$,64 B writes", ";4=1000,5=0,6=1;4=1;0=0,1=0,2=0,3=0");
