import { expect, test } from "bun:test";
import { join } from "node:path";
import { Piscina } from "piscina";

const EXPECT_THIS_FILE_TO_TAKE_SECONDS = 10;

test("Piscina basic functionality", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
  });

  const result = await piscina.run({ a: 4, b: 6 });
  expect(result).toBe(10);

  await piscina.destroy();
});

test("Piscina event loop cleanup", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
  });

  const results = await Promise.all([
    piscina.run({ a: 1, b: 2 }),
    piscina.run({ a: 3, b: 4 }),
    piscina.run({ a: 5, b: 6 }),
  ]);

  expect(results).toEqual([3, 7, 11]);

  await piscina.destroy();
});

test("Piscina with idleTimeout", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
    idleTimeout: 100,
    maxThreads: 1,
  });

  const result = await piscina.run({ a: 10, b: 20 });
  expect(result).toBe(30);

  await piscina.destroy();
});

test("Piscina error handling", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker-error.fixture.ts"),
  });

  const p = await piscina.run({ shouldThrow: true }).then(
    () => true,
    () => false,
  );

  expect(p).toBe(false);

  await piscina.destroy();
});

setTimeout(() => {
  console.error(new Error("Catastrophic failure, exiting so test can fail"));
  process.exit(1);
}, EXPECT_THIS_FILE_TO_TAKE_SECONDS * 1000).unref();
