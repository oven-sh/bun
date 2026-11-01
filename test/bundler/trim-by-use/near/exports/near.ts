import v8 from "node:v8";
import { AsyncLocalStorage } from "node:async_hooks";
console.log(
  typeof v8.getHeapStatistics().total_heap_size,
  typeof process.versions.v8,
  typeof process.versions.uv,
  typeof process.versions.napi,
  typeof process.versions.modules,
);
console.log(
  new AsyncLocalStorage().run(7, () => 7),
  process.hrtime().length,
);
