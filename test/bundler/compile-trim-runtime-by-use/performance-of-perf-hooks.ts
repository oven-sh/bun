import { performance as timeline } from "node:perf_hooks";
const mark = timeline.mark("start", { detail: { from: "node:perf_hooks" } });
console.log(mark.name, JSON.stringify(mark.detail), timeline.getEntriesByName("start").length);
