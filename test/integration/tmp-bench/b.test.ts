import { bench } from "./run";
bench("iobench.js", "--rounds", "3", "--only", "setT,setI,idle,worker,startup,spawn,ipc,shell,dns,fs.watch,os.");
