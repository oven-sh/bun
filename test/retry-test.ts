import { expect, test } from "bun:test";

let attempts = 0;
test(
  "flaky test with retry",
  () => {
    attempts++;
    console.log(`Attempt ${attempts}`);
    if (attempts < 3) {
      throw new Error(`Failed on attempt ${attempts}`);
    }
    expect(attempts).toBe(3);
  },
  { retry: 3 },
);
