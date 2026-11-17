import { test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { compareSwitches } from "./brotli-timing";

test.skipIf(isASAN || isDebug)(
  "time over time with a switch, up to quality 9",
  async () => {
    const sizes = [
      [256, 32, 5],
      [2048, 8, 5],
    ];
    await compareSwitches([0, 1, 2, 5], sizes, { same: 0, SL_RUST: 0x1000, SL_128: 0x2000, SL_MAX_0: 0x4000 });
    const larger = [
      [1024, 16, 4],
      [131072, 1, 3],
    ];
    await compareSwitches([5, 6, 7, 9], larger, { same: 0, SC_RUST: 0x20000, SC_GENERAL: 0x40000, SC_FOUR: 0x80000 });
  },
  170_000,
);
