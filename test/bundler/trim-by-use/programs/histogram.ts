import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";
const histogram = createHistogram();
for (const value of [1, 2, 3, 4, 100]) histogram.record(value);
console.log(histogram.min, histogram.max, histogram.count, histogram.percentile(50), Math.round(histogram.mean));
const delay = monitorEventLoopDelay({ resolution: 10 });
console.log(delay.enable(), delay.disable(), typeof delay.mean);
