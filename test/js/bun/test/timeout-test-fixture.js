import { test } from "bun:test";

test("test timeouts when expected", async () => {
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(1);
  }
  console.error("unreachable code");
}, 10);

test(
  "test timeouts when expected 2",
  async () => {
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(1);
    }
    console.error("unreachable code");
  },
  { timeout: 10 },
);

test("process doesn't hang on test with ref'd value", async () => {
  Bun.serve({
    port: 0,
    fetch() {},
  });
  for (let i = 0; i < 100; i++) {
    await Bun.sleep(1);
  }
  console.error("unreachable code");
}, 10);
