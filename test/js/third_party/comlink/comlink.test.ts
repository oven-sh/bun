import { test, expect, describe } from "bun:test";
import { join } from "path";
import * as Comlink from "comlink";

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
