import { expect, test } from "bun:test";
import { join } from "node:path";
import { Piscina } from "piscina";

test("Piscina basic functionality", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
  });

  try {
    const result = await piscina.run({ a: 4, b: 6 });
    expect(result).toBe(10);
  } finally {
    await piscina.destroy();
  }
});

test("Piscina event loop cleanup", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
  });

  try {
    const results = await Promise.all([
      piscina.run({ a: 1, b: 2 }),
      piscina.run({ a: 3, b: 4 }),
      piscina.run({ a: 5, b: 6 }),
    ]);

    expect(results).toEqual([3, 7, 11]);
  } finally {
    await piscina.destroy();
  }
});

test("Piscina with idleTimeout", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker.fixture.ts"),
    idleTimeout: 100,
    maxThreads: 1,
  });

  try {
    const result = await piscina.run({ a: 10, b: 20 });
    expect(result).toBe(30);

    await new Promise(resolve => setTimeout(resolve, 200));
  } finally {
    await piscina.destroy();
  }
});

test("Piscina error handling", async () => {
  const piscina = new Piscina({
    filename: join(import.meta.dir, "worker-error.fixture.ts"),
  });

  try {
    expect(piscina.run({ shouldThrow: true })).rejects.toThrow();
  } finally {
    await piscina.destroy();
  }
});

setTimeout(() => {
  console.log("Catastrophic failure, exiting so test can fail");
  process.exit(1);
}, 10_000).unref();
