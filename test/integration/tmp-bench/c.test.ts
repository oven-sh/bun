import { bench } from "./run";
bench("iobench.js", "--rounds", "3", "--only", "child ,named ,stream 256,FileSink,createReadStream,Bun.write");
