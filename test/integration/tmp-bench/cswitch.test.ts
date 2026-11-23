import { bench } from "./run";
bench("three.js", "busyall.js", "", "^sh ,^serve,^fetch,^http,^net,^udp,^lookup,^terminal,^worker,^gzip,^import,^glob", "4", "20");
