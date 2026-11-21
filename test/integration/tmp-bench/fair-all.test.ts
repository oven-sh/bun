import { bench } from "./run";
bench("fair.js", "all", "stream,buffered,start,stdin,stdin48,stdin256,fetch16,stat,reads32", "", "15");
