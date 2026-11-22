import { bench } from "./run";
bench("cond.js", "busy", "keep-alive,ping-pong k=1,server k=,8 MB body", "before;", "3");
