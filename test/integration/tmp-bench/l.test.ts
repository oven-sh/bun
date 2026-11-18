import { bench } from "./run";
bench("tune.js", "64 B writes,keep-alive x1$,500 conn,ping-pong k=1,ping-pong k=64", ";0=0;2=1;2=101;2=104;11=1");
