import { resolve } from "node:path";
import { test } from "node:test";
import { Piscina } from "piscina";

test("piscina atomics", async () => {
  const pool = new Piscina<void, void>({
    filename: resolve(__dirname, "simple.fixture.ts"),
    minThreads: 2,
    maxThreads: 2,
    atomics: "sync",
  });

  const tasks: Promise<void>[] = [];

  for (let i = 1; i <= 10000; i++) {
    tasks.push(pool.run());
  }

  await Promise.all(tasks);

  await pool.destroy();
});
