import { bench } from "./run";
bench("cond.js", "4", "tcp ping-pong k=1$,k=64,http ,tcp stream,tcp 500,worker ping-pong", "before;", "3");
