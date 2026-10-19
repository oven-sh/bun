import { performance as _performance } from "node:perf_hooks";

performance.now();
performance.timeOrigin;

_performance.now();
_performance.timeOrigin;

const observer = new PerformanceObserver((list, self) => {
  for (const entry of list.getEntries()) entry.name;
  self.disconnect();
});
observer.observe({ entryTypes: ["measure"] });
PerformanceObserver.supportedEntryTypes.includes("mark");
