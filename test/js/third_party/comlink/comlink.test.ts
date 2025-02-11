import { describe, expect, test } from "bun:test";
import * as Comlink from "comlink";
import { join } from "path";

describe("comlink", () => {
  test("should start without big delay", async () => {
    const worker = new Worker(join(import.meta.dir, "worker.fixture.ts"));
    const obj = Comlink.wrap(worker);
    const start = performance.now();
    //@ts-ignore
    await obj.counter;
    const end = performance.now();
    expect(end - start).toBeLessThan(100);
  });
});
