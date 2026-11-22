import { bench } from "./run";
bench("cond.js", "all", "child std,ipc,named pipe,lines into,64K write,shell echo,spawn", "before;", "3");
