import { bench } from "./run";
bench("fair.js", "all", "stream,buffered", ";18=131072;18=131072,15=1;18=131072,19=131072;18=262144", "15");
