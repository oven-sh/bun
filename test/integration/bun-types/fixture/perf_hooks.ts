import { performance as _performance } from "node:perf_hooks";
import { expectType } from "./utilities";

performance.now();
performance.timeOrigin;

_performance.now();
_performance.timeOrigin;

{
  expectType(new PerformanceMark("mark")).is<PerformanceMark>();
  new PerformanceMark("mark", { detail: { step: 1 }, startTime: 12.5 });
  // @ts-expect-error the mark name is required
  new PerformanceMark();
}

{
  const observer = new PerformanceObserver((entries, observer) => {
    expectType(entries).is<PerformanceObserverEntryList>();
    expectType(observer).is<PerformanceObserver>();
  });
  expectType(observer).is<PerformanceObserver>();
  // @ts-expect-error the callback is required
  new PerformanceObserver();

  expectType(PerformanceObserver.supportedEntryTypes).is<readonly string[]>();
}
