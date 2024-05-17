import { afterEach, beforeAll, beforeEach, describe, test } from "bun:test";

describe("timeout accounting", async () => {
  beforeEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  test(
    "should not time out (resolve=200ms, timeout=220ms)",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
    },
    {
      timeout: 220,
    },
  );
  test(
    "should not time out (resolve=600ms, timeout=1000ms)",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
    },
    {
      timeout: 1000,
    },
  );
  test(
    "should not time out (resolve=1000ms, timeout=1300ms)",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    },
    {
      timeout: 1300,
    },
  );
  test(
    "should not time out (resolve=1000ms, timeout=0ms)",
    async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
    },
    {
      timeout: 0,
    },
  );
});
