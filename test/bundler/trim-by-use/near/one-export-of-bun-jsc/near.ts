import { heapStats } from "bun:jsc";
console.log(heapStats().objectCount > 0);
