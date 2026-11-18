import { bench } from "./run";
bench("fsbench.js", "--rounds", "9", "--only", "install,run an,require,x20000");
