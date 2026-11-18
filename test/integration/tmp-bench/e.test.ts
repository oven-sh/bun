import { bench } from "./run";
bench("fsbench.js", "--rounds", "5", "--only", "Bun.,create,pipeline");
