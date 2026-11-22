import { bench } from "./run";
bench("cond.js", "all", "fs.,fs ,Bun.,open + close,promises,writer() one,FileSink,dns", "before;", "3");
