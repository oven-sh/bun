// See intl-golden.test.ts. The caches of src/icu belong to the process, so threads fill and read them at the same time.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { differencesFrom, fewerIfDebug, hasVersion, loadCases } from "./observe";

test.skipIf(!hasVersion)("four workers that start together get what was recorded", async () => {
  const topics = Object.values((await loadCases()).anywhere);
  const some = fewerIfDebug(topics.flatMap(topic => topic.filter((_, i) => i % 40 === 0)));
  const sources = some.map(([source]) => source);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => {
      const worker = new Worker(join(import.meta.dir, "worker-fixture.ts"));
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage(sources);
      return promise.finally(() => worker.terminate());
    }),
  );
  expect(results.map(result => differencesFrom(some, result))).toEqual(["", "", "", ""]);
});
