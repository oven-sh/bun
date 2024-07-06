import { test, expect } from "bun:test";

test.leak(
  "echo hi",
  async () => {
    await Bun.$`echo hi`.quiet();
  },
  { delta: 5, repeatCount: 500 },
);

test.leak(
  "echo hi text",
  async () => {
    await Bun.$`echo hi`.text();
  },
  { delta: 5, repeatCount: 500 },
);
