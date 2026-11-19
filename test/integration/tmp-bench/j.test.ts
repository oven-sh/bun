import { bench } from "./run";
bench("tune.js", "64 B writes,keep-alive x1$,stdin buffer,http 8 MB body,named pipe stream,Bun.write file");
