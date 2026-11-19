import { bench } from "./run";
bench("fsbench.js", "--rounds", "5", "--ms", "120", "--only", "Sync,callback,x32,promises,os.,process.,dns");
