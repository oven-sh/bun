import { bench } from "./run";
bench("fair.js", "all", "stream,buffered,start,stdin,fetch16,stat,reads32", ";12=65536;Q=524288", "15");
