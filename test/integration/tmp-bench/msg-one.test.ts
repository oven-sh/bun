import { bench } from "./run";
bench("cond.js", "4", "worker ping-pong,worker round,ipc p,named pipe ping-pong,stdio ping-pong,stdout 64K writes,128 B writes,stdin sink", ";4=1000,5=0,6=1;4=1;0=0,1=0,2=0,3=0");
