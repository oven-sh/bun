declare const PerformanceObserver: any, PerformanceMark: any, PerformanceMeasure: any;
const seen: string[] = [];
const observer = new PerformanceObserver((list: any) => {
  for (const entry of list.getEntries()) seen.push(entry.entryType + ":" + entry.name);
});
observer.observe({ entryTypes: ["mark", "measure"] });
const mark = performance.mark("start", { detail: { from: "use" } });
performance.mark("end");
const measure = performance.measure("span", "start", "end");
console.log(
  mark instanceof PerformanceMark,
  JSON.stringify(mark.detail),
  measure instanceof PerformanceMeasure,
  measure.duration >= 0,
);
console.log(
  performance
    .getEntriesByType("mark")
    .map((entry: any) => entry.name)
    .join(),
  performance.getEntriesByName("span").length,
);
await new Promise(resolve => setTimeout(resolve, 10));
console.log(seen.sort().join());
observer.disconnect();
performance.clearMarks();
performance.clearMeasures();
console.log(performance.getEntries().length);
